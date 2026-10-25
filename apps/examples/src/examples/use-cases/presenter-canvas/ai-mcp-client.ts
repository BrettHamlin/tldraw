import { useEffect, useRef, useState } from 'react'
import { T } from 'tldraw'
import { parsePresentation, type PresentationDocument } from './document'

const revision = T.integer.check((value) => {
	if (value < 0) throw new Error('Revision must be nonnegative')
})
const envelopeSchema = T.object({ sourceId: T.string, revision, document: T.unknown.nullable() })
const endpoint = 'http://127.0.0.1:5481'
const checkpointKey = 'presenter-mcp-consumed-revision'

interface DraftHost {
	getDocument(): PresentationDocument
	replaceDocument(document: PresentationDocument): void
	getRehearsalId(): string | null
}
interface Provenance {
	sourceId: string
	revision: number
}

export class McpDraftReceiver {
	private remote: { document: PresentationDocument; identity: Provenance } | null = null
	private rehearsals = new Map<string, Provenance | null>()
	constructor(
		private host: DraftHost,
		private consumed: string | null
	) {}

	markRehearsal(id: string, document: PresentationDocument) {
		const identity =
			this.remote && JSON.stringify(this.remote.document) === JSON.stringify(document)
				? this.remote.identity
				: null
		this.rehearsals.set(id, identity)
		if (this.rehearsals.size > 32) {
			const oldest = this.rehearsals.keys().next().value
			if (oldest) this.rehearsals.delete(oldest)
		}
	}

	getRehearsalProvenance() {
		const id = this.host.getRehearsalId()
		const identity = id ? this.rehearsals.get(id) : null
		return {
			rehearsalSourceId: identity?.sourceId ?? null,
			rehearsalRevision: identity?.revision ?? null,
		}
	}

	receive(input: unknown) {
		const envelope = envelopeSchema.validate(input)
		try {
			let state: 'received' | 'applied' = 'received'
			if (envelope.document) {
				const document = parsePresentation(envelope.document)
				const key = `${envelope.sourceId}:${envelope.revision}`
				if (key !== this.consumed) {
					this.host.replaceDocument(document)
					this.consumed = key
				}
				this.remote = {
					document,
					identity: { sourceId: envelope.sourceId, revision: envelope.revision },
				}
				if (JSON.stringify(this.host.getDocument()) === JSON.stringify(document)) state = 'applied'
			} else this.remote = null
			return { envelope, state, consumed: this.consumed, ...this.getRehearsalProvenance() }
		} catch (error) {
			const state = 'error' as const
			return {
				envelope,
				state,
				message: (error instanceof Error ? error.message : 'Invalid presentation').slice(0, 900),
				consumed: this.consumed,
				...this.getRehearsalProvenance(),
			}
		}
	}
}

export function usePresenterMcp(host: DraftHost) {
	const currentHost = useRef(host)
	currentHost.current = host
	const receiverRef = useRef<McpDraftReceiver | null>(null)
	const [message, setMessage] = useState('Connecting to the local tldraw MCP server…')
	useEffect(() => {
		let disposed = false
		let timer: ReturnType<typeof setTimeout> | undefined
		let consumed: string | null = null
		try {
			consumed = sessionStorage.getItem(checkpointKey)
		} catch {
			/* Draft sync still works without session storage. */
		}
		const receiver = new McpDraftReceiver(
			{
				getDocument: () => currentHost.current.getDocument(),
				replaceDocument: (document) => currentHost.current.replaceDocument(document),
				getRehearsalId: () => currentHost.current.getRehearsalId(),
			},
			consumed
		)
		receiverRef.current = receiver
		const browserId = crypto.randomUUID()
		const abort = new AbortController()
		async function acknowledge(value: unknown) {
			const response = await fetch(`${endpoint}/presenter/ack`, {
				method: 'POST',
				signal: abort.signal,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(value),
			})
			if (!response.ok) throw new Error('MCP acknowledgement was not accepted')
		}
		async function poll() {
			try {
				const response = await fetch(`${endpoint}/presenter/draft`, { signal: abort.signal })
				if (!response.ok) throw new Error('MCP server unavailable')
				const input: unknown = await response.json()
				if (disposed) return
				const envelope = envelopeSchema.validate(input)
				const received = receiver.receive(envelope)
				try {
					if (received.consumed) sessionStorage.setItem(checkpointKey, received.consumed)
				} catch {
					/* The named presentation remains exportable. */
				}
				await acknowledge({
					sourceId: envelope.sourceId,
					revision: envelope.revision,
					browserId,
					state: received.state,
					rehearsalSourceId: received.rehearsalSourceId,
					rehearsalRevision: received.rehearsalRevision,
					...(received.state === 'error' ? { message: received.message } : {}),
				})
				if (received.state === 'error') {
					if (!disposed) setMessage(`Drawing rejected: ${received.message}`)
					return
				}
				if (!disposed)
					setMessage(
						envelope.document
							? `Connected to tldraw MCP · draft revision ${envelope.revision}`
							: 'Connected to tldraw MCP · ask Codex to create a presentation'
					)
			} catch (error) {
				if (!disposed)
					setMessage(
						error instanceof Error && error.name !== 'TypeError'
							? error.message
							: 'Local tldraw MCP server is not running. Your saved presentations remain available.'
					)
			} finally {
				if (!disposed) timer = setTimeout(poll, 1000)
			}
		}
		void poll()
		return () => {
			disposed = true
			clearTimeout(timer)
			abort.abort()
			if (receiverRef.current === receiver) receiverRef.current = null
		}
	}, [])
	return {
		message,
		markRehearsal: (id: string, document: PresentationDocument) =>
			receiverRef.current?.markRehearsal(id, document),
	}
}

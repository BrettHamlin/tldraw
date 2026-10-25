import { parsePresentation, type PresentationDocument } from './document'
import { PreparedPlayback, type PlaybackScene, type PlaybackState } from './playback'

export class AudienceSession {
	document: PresentationDocument | null = null
	playback: PreparedPlayback | null = null
	rehearsalId: string | null = null
	constructor(
		private createScene: (document: PresentationDocument) => PlaybackScene,
		private publish: (state: PlaybackState) => void
	) {}
	initialize(value: unknown, rehearsalId: string, replace = false) {
		if (this.rehearsalId === rehearsalId || (this.playback && !replace)) return false
		const document = parsePresentation(value)
		this.playback?.command('reset')
		this.playback?.dispose()
		this.document = document
		this.rehearsalId = rehearsalId
		this.playback = new PreparedPlayback(this.createScene(document), this.publish)
		this.publish(this.playback.getState())
		return true
	}
	dispose() {
		this.playback?.dispose()
	}
}

interface RehearsalRequest {
	initialize: PresentationDocument
	rehearsalId: string
	replace: boolean
}

export class PresenterSession {
	document: PresentationDocument
	state: PlaybackState = { beat: -1, status: 'ready' }
	private pending: RehearsalRequest | null
	private sent = false
	private connected = false
	private rehearsalId: string | null = null

	constructor(document: PresentationDocument, rehearsalId: string) {
		this.document = document
		this.pending = { initialize: document, rehearsalId, replace: false }
	}

	getCurrentRehearsalId() {
		return this.rehearsalId
	}

	rehearse(document: PresentationDocument, rehearsalId: string) {
		this.pending = { initialize: parsePresentation(document), rehearsalId, replace: true }
		this.sent = false
	}

	setConnected(connected: boolean) {
		if (this.connected && !connected) this.sent = false
		this.connected = connected
	}

	deliver(send: (request: RehearsalRequest) => void) {
		if (!this.pending || this.sent) return
		this.sent = true
		send(this.pending)
	}

	hello(value: unknown, rehearsalId: unknown, send: (request: RehearsalRequest) => void) {
		if (rehearsalId !== null && typeof rehearsalId !== 'string') return
		if (this.pending?.replace) {
			if (rehearsalId !== this.pending.rehearsalId) {
				this.deliver(send)
				return
			}
			this.document = this.pending.initialize
			this.pending = null
			this.rehearsalId = rehearsalId
			this.state = { beat: -1, status: 'ready' }
		} else if (value) {
			this.document = parsePresentation(value)
			this.rehearsalId = rehearsalId
			this.pending = null
		} else {
			this.pending ??= {
				initialize: this.document,
				rehearsalId: this.rehearsalId ?? crypto.randomUUID(),
				replace: false,
			}
			this.deliver(send)
		}
	}

	receiveState(state: PlaybackState, rehearsalId: unknown) {
		if (typeof rehearsalId !== 'string') return false
		if (this.pending) {
			if (rehearsalId !== this.pending.rehearsalId) return false
			this.document = this.pending.initialize
			this.rehearsalId = rehearsalId
			this.pending = null
		}
		if (this.rehearsalId !== null && rehearsalId !== this.rehearsalId) return false
		this.state = state
		return true
	}
}

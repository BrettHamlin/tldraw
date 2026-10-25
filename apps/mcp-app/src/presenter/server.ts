/// <reference types="node" />

import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import {
	acknowledgementSchema,
	presentationSchema,
	revisionSchema,
	type PresentationDocument,
} from './schema'

const origins = new Set(['http://localhost:5420', 'http://127.0.0.1:5420'])
const maxBodyBytes = 16 * 1024 * 1024
const browserTtlMs = 30000
const presenterUrl = 'http://localhost:5420/presenter-canvas/full'

class HttpError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message)
	}
}

async function readJson(req: IncomingMessage): Promise<unknown> {
	if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
		throw new HttpError(415, 'Expected application/json')
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		size += buffer.length
		if (size > maxBodyBytes) throw new HttpError(413, 'Request exceeds 16 MiB')
		chunks.push(buffer)
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8'))
	} catch {
		throw new HttpError(400, 'Invalid JSON')
	}
}

function json(res: ServerResponse, status: number, value: unknown) {
	res
		.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
		.end(JSON.stringify(value))
}
function result(value: Record<string, unknown>) {
	return {
		content: [{ type: 'text' as const, text: JSON.stringify(value) }],
		structuredContent: value,
	}
}

export async function startPresenterServer({ port = 5481 }: { port?: number } = {}) {
	const sourceId = randomUUID()
	let revision = 0
	let document: PresentationDocument | null = null
	const browsers = new Map<string, z.infer<typeof acknowledgementSchema> & { seenAt: number }>()
	const activeServers = new Set<McpServer>()
	const draft = () => ({ sourceId, revision, document })
	const status = () => {
		const now = Date.now()
		for (const [id, browser] of browsers)
			if (now - browser.seenAt > browserTtlMs) browsers.delete(id)
		return {
			sourceId,
			revision,
			connected: browsers.size > 0,
			browsers: [...browsers.values()],
			browserTtlMs,
		}
	}
	const receipt = () => ({ sourceId, revision, saved: true, presenterUrl, browser: status() })
	function mcpServer() {
		const mcp = new McpServer({ name: 'tldraw-presenter', version: '1.0.0' })
		const readOnly = { readOnlyHint: true, openWorldHint: false }
		mcp.registerTool(
			'presenter_schema',
			{
				description:
					'Read the version 1 progressive presentation JSON schema and local browser bridge contract. Coordinates are canvas pixels; timing is milliseconds within each beat; beats hold for the presenter.',
				inputSchema: {},
				annotations: readOnly,
			},
			() =>
				result({
					schema: z.toJSONSchema(presentationSchema),
					presenterUrl,
					bridge: {
						draft: 'GET /presenter/draft',
						acknowledgement: 'POST /presenter/ack',
						status: 'GET /presenter/status',
						acknowledgementSchema: z.toJSONSchema(acknowledgementSchema),
						pollIntervalMs: 1000,
						browserTtlMs,
					},
					rules: [
						'Submit replaces the editable draft only; the browser must preserve active rehearsal.',
						'Save receipts do not prove drawing or browser acceptance.',
						'Submit requires expectedSourceId and expectedRevision from the latest presenter_get; either mismatch is a conflict.',
						'Rehearsal source ID and revision must both be null or both present, identifying the exact chosen active rehearsal rather than matching draft content. A rehearsal from an older server source remains valid after restart.',
						'Browser applies its authoritative parsePresentation before acknowledging applied.',
						'Beat IDs must be unique. All coordinates must fit the declared canvas. At most 200000 positions across the presentation.',
						'Use ordered sampled stroke points for progressive drawing. Choose Rehearse this deck in the browser, then use the audience Next controls to advance beats.',
					],
				})
		)
		mcp.registerTool(
			'presenter_get',
			{
				description:
					'Read the current server draft, sourceId, and revision. A null document means no draft has been submitted.',
				inputSchema: {},
				annotations: readOnly,
			},
			() => result(draft())
		)
		mcp.registerTool(
			'presenter_submit',
			{
				description:
					'Create or replace a validated presentation draft. First call presenter_get; supply its sourceId as expectedSourceId and revision as expectedRevision (0 creates). Either mismatch returns a conflict without saving. Does not start or replace browser rehearsal. Check presenter_status for browser acknowledgement.',
				inputSchema: {
					expectedSourceId: z.uuid(),
					expectedRevision: revisionSchema,
					document: presentationSchema,
				},
				annotations: {
					readOnlyHint: false,
					destructiveHint: true,
					idempotentHint: false,
					openWorldHint: false,
				},
			},
			(input) => {
				if (input.expectedSourceId !== sourceId || input.expectedRevision !== revision)
					return {
						...result({
							error: 'Source or revision conflict; read presenter_get before retrying.',
							...receipt(),
							saved: false,
						}),
						isError: true,
					}
				document = input.document
				revision++
				return result(receipt())
			}
		)
		mcp.registerTool(
			'presenter_preview',
			{
				description:
					'Validate a draft and return a summary without saving it or changing the browser.',
				inputSchema: { document: presentationSchema },
				annotations: readOnly,
			},
			({ document }) =>
				result({
					valid: true,
					title: document.title,
					beats: document.beats.length,
					actions: document.beats.reduce((sum, beat) => sum + beat.actions.length, 0),
				})
		)
		mcp.registerTool(
			'presenter_status',
			{
				description:
					'Read recent browser self-reported acknowledgements. connected means a heartbeat in the last 30 seconds; applied means browser accepted the editable draft, not visible drawing. rehearsalSourceId and rehearsalRevision identify the separate active playback source, including a source retained across server restart; both are null when no server-sourced rehearsal is active.',
				inputSchema: {},
				annotations: readOnly,
			},
			() => result(status())
		)
		return mcp
	}
	const http = createServer(async (req, res) => {
		try {
			const actualPort = http.address()
			const allowedHosts =
				typeof actualPort === 'object' && actualPort
					? new Set([`127.0.0.1:${actualPort.port}`, `localhost:${actualPort.port}`])
					: new Set<string>()
			if (!req.headers.host || !allowedHosts.has(req.headers.host))
				throw new HttpError(403, 'Loopback Host required')
			const origin = req.headers.origin
			if (origin && !origins.has(origin)) throw new HttpError(403, 'Origin not allowed')
			if (origin) {
				res.setHeader('Access-Control-Allow-Origin', origin)
				res.setHeader('Vary', 'Origin')
			}
			const path = req.url
			if (path === '/mcp') {
				// Browser pages use only data endpoints; native MCP clients send no Origin.
				if (origin) throw new HttpError(403, 'Use the browser data bridge')
				if (req.method !== 'POST') throw new HttpError(405, 'Stateless MCP accepts POST only')
				const body = await readJson(req)
				const mcp = mcpServer()
				activeServers.add(mcp)
				const transport = new StreamableHTTPServerTransport({
					sessionIdGenerator: undefined,
					enableJsonResponse: true,
				})
				res.once('close', () => {
					activeServers.delete(mcp)
					void mcp.close()
				})
				await mcp.connect(transport)
				await transport.handleRequest(req, res, body)
				return
			}
			if (!['/presenter/draft', '/presenter/status', '/presenter/ack'].includes(path ?? ''))
				throw new HttpError(404, 'Not found')
			if (req.method === 'OPTIONS') {
				if (!origin) throw new HttpError(403, 'Browser Origin required')
				res
					.writeHead(204, {
						'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
						'Access-Control-Allow-Headers': 'Content-Type',
						'Access-Control-Max-Age': '600',
					})
					.end()
				return
			}
			if (path === '/presenter/draft' && req.method === 'GET') return json(res, 200, draft())
			if (path === '/presenter/status' && req.method === 'GET') return json(res, 200, status())
			if (path === '/presenter/ack' && req.method === 'POST') {
				if (!origin) throw new HttpError(403, 'Browser Origin required')
				const ack = acknowledgementSchema.parse(await readJson(req))
				if (
					ack.sourceId !== sourceId ||
					ack.revision !== revision ||
					(ack.rehearsalSourceId === sourceId &&
						ack.rehearsalRevision !== null &&
						ack.rehearsalRevision > revision)
				)
					throw new HttpError(409, 'Stale source or revision')
				status()
				if (!browsers.has(ack.browserId) && browsers.size >= 16)
					throw new HttpError(429, 'Too many browser clients')
				browsers.set(ack.browserId, { ...ack, seenAt: Date.now() })
				return json(res, 200, { accepted: true, ...status() })
			}
			throw new HttpError(405, 'Method not allowed')
		} catch (error) {
			if (res.headersSent || res.destroyed) return
			json(
				res,
				error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500,
				{ error: error instanceof Error ? error.message : 'Request failed' }
			)
		}
	})
	http.requestTimeout = 15000
	http.headersTimeout = 10000
	await new Promise<void>((resolve, reject) => {
		http.once('error', reject)
		http.listen(port, '127.0.0.1', resolve)
	})
	const address = http.address()
	if (!address || typeof address === 'string') throw new Error('Expected TCP listener')
	return {
		url: `http://127.0.0.1:${address.port}`,
		async close() {
			await Promise.all([...activeServers].map((mcp) => mcp.close()))
			await new Promise<void>((resolve, reject) => {
				http.close((error) => (error ? reject(error) : resolve()))
				http.closeAllConnections()
			})
		},
	}
}

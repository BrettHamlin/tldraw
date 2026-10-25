import { randomUUID } from 'node:crypto'
import { request } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { revisionSchema } from './schema'
import { startPresenterServer } from './server'

const document = {
	version: 1,
	title: 'A request',
	canvas: { width: 900, height: 680 },
	beats: [
		{
			id: 'request',
			title: 'Send',
			note: 'Explain',
			actions: [
				{
					kind: 'stroke',
					start: 0,
					duration: 1000,
					color: 'blue',
					points: [
						{ x: 10, y: 20, pressure: 0.5 },
						{ x: 100, y: 20, pressure: 1 },
					],
				},
				{ kind: 'text', start: 1000, duration: 1, text: 'Server', x: 100, y: 30 },
			],
		},
	],
}
const origin = 'http://localhost:5420'
const envelopeSchema = z.looseObject({ sourceId: z.uuid(), revision: revisionSchema })

describe('local presenter MCP', () => {
	let service: Awaited<ReturnType<typeof startPresenterServer>>
	let client: Client
	beforeEach(async () => {
		service = await startPresenterServer({ port: 0 })
		client = new Client({ name: 'presenter-test', version: '1.0.0' })
		await client.connect(new StreamableHTTPClientTransport(new URL(`${service.url}/mcp`)))
	})
	afterEach(async () => {
		vi.restoreAllMocks()
		await client.close()
		await service.close()
	})
	const submit = async (client: Client, expectedRevision = 0, value: unknown = document) => {
		const current = envelopeSchema.parse(
			(await client.callTool({ name: 'presenter_get', arguments: {} })).structuredContent
		)
		return client.callTool({
			name: 'presenter_submit',
			arguments: {
				expectedSourceId: current.sourceId,
				expectedRevision,
				document: value,
			},
		})
	}
	async function get(path: string) {
		return envelopeSchema.parse(await (await fetch(`${service.url}${path}`)).json())
	}
	function ack(value: unknown, browserOrigin = origin) {
		return fetch(`${service.url}/presenter/ack`, {
			method: 'POST',
			headers: { Origin: browserOrigin, 'Content-Type': 'application/json' },
			body: JSON.stringify(value),
		})
	}
	it('exposes real MCP schemas, validates previews, and publishes revisions separately from browser receipt', async () => {
		const list = await client.listTools()
		expect(list.tools.map((tool) => tool.name)).toEqual([
			'presenter_schema',
			'presenter_get',
			'presenter_submit',
			'presenter_preview',
			'presenter_status',
		])
		expect(list.tools.find((tool) => tool.name === 'presenter_submit')?.inputSchema).toMatchObject({
			required: ['expectedSourceId', 'expectedRevision', 'document'],
			properties: { expectedSourceId: { type: 'string', format: 'uuid' } },
		})
		const schema = await client.callTool({ name: 'presenter_schema', arguments: {} })
		expect(schema.isError).not.toBe(true)
		expect(schema.structuredContent).toMatchObject({
			schema: { type: 'object' },
			bridge: { draft: 'GET /presenter/draft' },
		})
		const preview = await client.callTool({ name: 'presenter_preview', arguments: { document } })
		expect(preview.structuredContent).toEqual({
			valid: true,
			title: 'A request',
			beats: 1,
			actions: 2,
		})
		expect(await get('/presenter/draft')).toMatchObject({ revision: 0, document: null })
		const saved = await submit(client)
		expect(saved.structuredContent).toMatchObject({
			revision: 1,
			saved: true,
			presenterUrl: 'http://localhost:5420/presenter-canvas/full',
			browser: { connected: false, browsers: [] },
		})
		const draft = await get('/presenter/draft')
		expect(draft).toMatchObject({ revision: 1, document })
		const response = await ack({
			sourceId: draft.sourceId,
			revision: 1,
			browserId: 'tab-1',
			state: 'applied',
			rehearsalSourceId: null,
			rehearsalRevision: null,
		})
		expect(response.status).toBe(200)
		expect(await get('/presenter/status')).toMatchObject({
			connected: true,
			browsers: [{ revision: 1, state: 'applied', rehearsalRevision: null }],
		})
		await submit(client, 1, { ...document, title: 'Edited' })
		expect(await get('/presenter/status')).toMatchObject({
			revision: 2,
			browsers: [{ revision: 1 }],
		})
		expect(
			(
				await ack({
					sourceId: draft.sourceId,
					revision: 1,
					browserId: 'tab-1',
					state: 'applied',
					rehearsalSourceId: null,
					rehearsalRevision: null,
				})
			).status
		).toBe(409)
		expect(
			(
				await ack({
					sourceId: draft.sourceId,
					revision: 2,
					browserId: 'tab-1',
					state: 'applied',
					rehearsalSourceId: draft.sourceId,
					rehearsalRevision: 1,
				})
			).status
		).toBe(200)
	})
	it('keeps the last valid draft when validation or optimistic concurrency fails', async () => {
		await submit(client)
		const before = await get('/presenter/draft')
		const invalid = [
			{ ...document, version: 2 },
			{ ...document, beats: [] },
			{ ...document, beats: [document.beats[0], document.beats[0]] },
			{
				...document,
				canvas: { width: 100, height: 100 },
				beats: [
					{
						...document.beats[0],
						actions: [{ kind: 'text', start: 0, duration: 1, text: 'outside', x: 101, y: 10 }],
					},
				],
			},
			{
				...document,
				beats: [
					{
						...document.beats[0],
						actions: [
							{
								kind: 'stroke',
								start: 0,
								duration: 1,
								color: 'blue',
								points: [{ x: 10, y: 10, pressure: 2 }],
							},
						],
					},
				],
			},
			{ ...document, execute: 'arbitrary code' },
		]
		for (const value of invalid) expect((await submit(client, 1, value)).isError).toBe(true)
		const conflict = await submit(client)
		expect(conflict.isError).toBe(true)
		expect(conflict.structuredContent).toMatchObject({ saved: false, revision: 1 })
		expect(await get('/presenter/draft')).toEqual(before)
	})
	it('rejects stale source edits after restart even when revision counters match', async () => {
		await submit(client)
		const old = envelopeSchema.parse(
			(await client.callTool({ name: 'presenter_get', arguments: {} })).structuredContent
		)
		await client.close()
		await service.close()
		service = await startPresenterServer({ port: 0 })
		client = new Client({ name: 'restarted-test', version: '1.0.0' })
		await client.connect(new StreamableHTTPClientTransport(new URL(`${service.url}/mcp`)))
		await submit(client, 0, { ...document, title: 'Different current draft' })
		const before = await get('/presenter/draft')
		expect(before.revision).toBe(old.revision)
		expect(before.sourceId).not.toBe(old.sourceId)
		const conflict = await client.callTool({
			name: 'presenter_submit',
			arguments: { expectedSourceId: old.sourceId, expectedRevision: old.revision, document },
		})
		expect(conflict.isError).toBe(true)
		expect(conflict.structuredContent).toMatchObject({
			saved: false,
			sourceId: before.sourceId,
			revision: 1,
		})
		for (const expectedSourceId of [undefined, 'not-a-uuid']) {
			expect(
				(
					await client.callTool({
						name: 'presenter_submit',
						arguments: { expectedSourceId, expectedRevision: 1, document },
					})
				).isError
			).toBe(true)
		}
		expect(await get('/presenter/draft')).toEqual(before)
		expect((await submit(client, 1)).structuredContent).toMatchObject({ saved: true, revision: 2 })
	})
	it('keeps rehearsal identity separate from the current draft envelope across restart', async () => {
		const draft = await get('/presenter/draft')
		const body = {
			sourceId: draft.sourceId,
			revision: 0,
			browserId: 'tab-rehearsal',
			state: 'applied',
			rehearsalSourceId: null,
			rehearsalRevision: null,
		}
		for (const rehearsal of [
			{ rehearsalSourceId: draft.sourceId, rehearsalRevision: null },
			{ rehearsalSourceId: null, rehearsalRevision: 0 },
			{ rehearsalSourceId: 'not-a-uuid', rehearsalRevision: 0 },
			{ rehearsalRevision: null },
			{ rehearsalSourceId: null },
		]) {
			const { rehearsalSourceId: _source, rehearsalRevision: _revision, ...envelope } = body
			expect((await ack({ ...envelope, ...rehearsal })).status).toBe(400)
		}
		expect(
			(await ack({ ...body, rehearsalSourceId: draft.sourceId, rehearsalRevision: 1 })).status
		).toBe(409)
		const oldSourceId = randomUUID()
		expect(
			(await ack({ ...body, rehearsalSourceId: oldSourceId, rehearsalRevision: 10 })).status
		).toBe(200)
		expect(await get('/presenter/status')).toMatchObject({
			browsers: [{ ...body, rehearsalSourceId: oldSourceId, rehearsalRevision: 10 }],
		})
		expect(
			(await client.callTool({ name: 'presenter_status', arguments: {} })).structuredContent
		).toMatchObject({
			browsers: [{ rehearsalSourceId: oldSourceId, rehearsalRevision: 10 }],
		})
		expect(
			(
				await ack({
					...body,
					sourceId: oldSourceId,
					rehearsalSourceId: oldSourceId,
					rehearsalRevision: 10,
				})
			).status
		).toBe(409)
		expect(
			(await ack({ ...body, revision: 1, rehearsalSourceId: oldSourceId, rehearsalRevision: 10 }))
				.status
		).toBe(409)
		expect((await ack(body)).status).toBe(200)
	})
	it('enforces Host, Origin, media type, ack source and revision boundaries', async () => {
		const draft = await get('/presenter/draft')
		const body = {
			sourceId: draft.sourceId,
			revision: 0,
			browserId: 'tab-1',
			state: 'received',
			rehearsalSourceId: null,
			rehearsalRevision: null,
		}
		const badHostStatus = await new Promise((resolve, reject) => {
			const req = request(
				`${service.url}/presenter/draft`,
				{ headers: { Host: 'evil.example' } },
				(res) => {
					res.resume()
					resolve(res.statusCode)
				}
			)
			req.on('error', reject)
			req.end()
		})
		expect(badHostStatus).toBe(403)
		expect(
			(
				await fetch(`${service.url}/presenter/draft`, {
					headers: { Origin: 'https://evil.example' },
				})
			).status
		).toBe(403)
		const response = await fetch(`${service.url}/presenter/draft`, { headers: { Origin: origin } })
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
		expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
		expect(
			(
				await fetch(`${service.url}/presenter/ack`, {
					method: 'OPTIONS',
					headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
				})
			).status
		).toBe(204)
		expect((await ack(body, 'https://evil.example')).status).toBe(403)
		expect(
			(
				await fetch(`${service.url}/presenter/ack`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})
			).status
		).toBe(403)
		expect((await ack({ ...body, sourceId: '00000000-0000-4000-8000-000000000000' })).status).toBe(
			409
		)
		expect((await ack({ ...body, revision: 1 })).status).toBe(409)
		expect(
			(await ack({ ...body, rehearsalSourceId: draft.sourceId, rehearsalRevision: 1 })).status
		).toBe(409)
		expect((await ack({ ...body, state: 'drawn' })).status).toBe(400)
		expect(
			(
				await fetch(`${service.url}/mcp`, {
					method: 'POST',
					headers: { Origin: origin, 'Content-Type': 'application/json' },
					body: '{}',
				})
			).status
		).toBe(403)
		expect((await fetch(`${service.url}/mcp`, { method: 'POST', body: '{}' })).status).toBe(415)
		expect(
			(
				await fetch(`${service.url}/mcp`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: '{',
				})
			).status
		).toBe(400)
	})
	it('expires browser heartbeats and reports errors without discarding the draft', async () => {
		await submit(client)
		const draft = await get('/presenter/draft')
		const now = vi.spyOn(Date, 'now').mockReturnValue(100000)
		expect(
			(
				await ack({
					sourceId: draft.sourceId,
					revision: 1,
					browserId: 'tab-1',
					state: 'error',
					rehearsalSourceId: null,
					rehearsalRevision: null,
					message: 'Frontend validation rejected the draft',
				})
			).status
		).toBe(200)
		expect(await get('/presenter/status')).toMatchObject({
			connected: true,
			browsers: [{ state: 'error' }],
		})
		now.mockReturnValue(130001)
		expect(await get('/presenter/status')).toMatchObject({ connected: false, browsers: [] })
		expect(await get('/presenter/draft')).toEqual(draft)
	})
	it('survives client disconnect and aborted requests, and releases its listening port on close', async () => {
		await submit(client)
		await client.close()
		await new Promise<void>((resolve) => {
			const interrupted = request(`${service.url}/mcp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			})
			interrupted.on('error', () => {})
			interrupted.on('close', resolve)
			interrupted.write('{')
			setImmediate(() => interrupted.destroy())
		})
		const second = new Client({ name: 'second', version: '1.0.0' })
		await second.connect(new StreamableHTTPClientTransport(new URL(`${service.url}/mcp`)))
		try {
			expect(
				(await second.callTool({ name: 'presenter_get', arguments: {} })).structuredContent
			).toMatchObject({ revision: 1, document })
		} finally {
			await second.close()
		}
		const port = Number(new URL(service.url).port)
		await service.close()
		service = await startPresenterServer({ port })
		expect(service.url).toBe(`http://127.0.0.1:${port}`)
	})
})

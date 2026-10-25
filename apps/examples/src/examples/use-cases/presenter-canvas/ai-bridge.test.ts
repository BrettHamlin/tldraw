import { createAiAuthoringBridge, installAiAuthoringBridge } from './ai-bridge'
import { parsePresentation } from './document'

function authoring() {
	const initial = {
		version: 1,
		title: 'Original',
		canvas: { width: 900, height: 680 },
		beats: [{ id: 'one', title: 'One', note: '', actions: [] }],
	}
	let document = parsePresentation(initial)
	const replaceDocument = vi.fn((next: typeof document) => {
		document = next
	})
	const host = { getDocument: () => document, replaceDocument }
	return { host, bridge: createAiAuthoringBridge(host) }
}

afterEach(() => vi.unstubAllGlobals())

it('rejects invalid authoring without replacing the current draft', () => {
	const { host, bridge } = authoring()
	const before = bridge.getDocument()
	expect(() => bridge.replaceDocument({ ...before, beats: [] })).toThrow()
	expect(host.replaceDocument).not.toHaveBeenCalled()
	expect(bridge.getDocument()).toEqual(before)
})

it('applies a validated authored document and returns its actual contents', () => {
	const { host, bridge } = authoring()
	const authored = bridge.describe().example
	expect(bridge.replaceDocument(authored)).toEqual({ title: authored.title, beats: 1, actions: 2 })
	expect(host.replaceDocument).toHaveBeenCalledOnce()
	expect(bridge.getDocument()).toEqual(authored)
	authored.title = 'Changed after submission'
	expect(bridge.getDocument().title).toBe('A request reaches a server')
})

it('returns detached document data so reads cannot silently mutate the draft', () => {
	const { bridge } = authoring()
	const read = bridge.getDocument()
	read.title = 'Mutated'
	read.beats.length = 0
	expect(bridge.getDocument()).toMatchObject({ title: 'Original', beats: [{ id: 'one' }] })
})

it('removes only its own bridge when an authoring view unmounts', () => {
	vi.stubGlobal('window', {})
	const { host } = authoring()
	const first = installAiAuthoringBridge(host)
	const second = installAiAuthoringBridge(host)
	const latest = window.tldrawPresenter
	first()
	expect(window.tldrawPresenter).toBe(latest)
	second()
	expect(window.tldrawPresenter).toBeUndefined()
})

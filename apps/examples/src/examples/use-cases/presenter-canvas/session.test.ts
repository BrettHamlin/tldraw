import { beatDuration, parsePresentation } from './document'
import { sampleDocument } from './prepared'
import { AudienceSession, PresenterSession } from './session'

afterEach(() => vi.useRealTimers())
it('plays the chosen document, preserves a paused show on reconnect, and resets only on explicit replacement', () => {
	vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
	const reset = vi.fn()
	const render = vi.fn()
	const createScene = vi.fn((doc: typeof sampleDocument) => ({
		durations: doc.beats.map(beatDuration),
		begin: vi.fn(),
		reset,
		render,
	}))
	const session = new AudienceSession(createScene, vi.fn())
	const chosen = parsePresentation({
		...sampleDocument,
		title: 'Chosen deck',
		beats: [sampleDocument.beats[2]],
	})
	session.initialize(chosen, 'one')
	chosen.title = 'Unsubmitted author edit'
	expect(session.document?.title).toBe('Chosen deck')
	expect(createScene.mock.calls[0][0].beats).toHaveLength(1)
	session.playback?.command('next')
	vi.advanceTimersByTime(500)
	session.playback?.command('pause')
	const paused = session.playback?.getState()
	expect(paused).toEqual({ beat: 0, status: 'paused' })
	expect(session.initialize(sampleDocument, 'one', true)).toBe(false)
	expect(session.initialize(sampleDocument, 'reconnect')).toBe(false)
	expect(session.playback?.getState()).toEqual(paused)
	expect(reset).not.toHaveBeenCalled()
	expect(() => session.initialize({}, 'bad', true)).toThrow()
	expect(session.playback?.getState()).toEqual(paused)
	expect(session.initialize(sampleDocument, 'two', true)).toBe(true)
	expect(reset).toHaveBeenCalledTimes(1)
	expect(session.playback?.getState()).toEqual({ beat: -1, status: 'ready' })
	session.playback?.command('next')
	vi.advanceTimersByTime(beatDuration(sampleDocument.beats[0]) + 16)
	expect(session.playback?.getState()).toEqual({ beat: 0, status: 'waiting' })
	session.playback?.command('reset')
	expect(session.playback?.getState()).toEqual({ beat: -1, status: 'ready' })
	session.dispose()
	expect(vi.getTimerCount()).toBe(0)
})

it('delivers an explicit offline rehearsal once on reconnect and changes cues only on audience ack', () => {
	const presenter = new PresenterSession(sampleDocument, 'initial')
	const publish = vi.fn()
	const audience = new AudienceSession(
		(doc) => ({
			durations: doc.beats.map(beatDuration),
			begin: vi.fn(),
			reset: vi.fn(),
			render: vi.fn(),
		}),
		publish
	)
	audience.initialize(sampleDocument, 'audience-a')
	presenter.hello(audience.document, audience.rehearsalId, vi.fn())
	presenter.receiveState({ beat: 1, status: 'paused' }, audience.rehearsalId)
	presenter.setConnected(true)
	presenter.setConnected(false)
	const replacement = parsePresentation({
		...sampleDocument,
		title: 'Show B',
		beats: [sampleDocument.beats[2]],
	})
	presenter.rehearse(replacement, 'show-b')
	replacement.title = 'Ordinary unsent draft edit'
	const send = vi.fn((request: { initialize: unknown; rehearsalId: string; replace: boolean }) => {
		audience.initialize(request.initialize, request.rehearsalId, request.replace)
	})
	// The old audience announces A before it receives the queued explicit show B.
	presenter.hello(audience.document, audience.rehearsalId, send)
	presenter.setConnected(true)
	presenter.deliver(send)
	presenter.deliver(send)
	expect(send).toHaveBeenCalledTimes(1)
	expect(audience.document?.title).toBe('Show B')
	expect(presenter.document.title).toBe(sampleDocument.title)
	expect(presenter.state).toEqual({ beat: 1, status: 'paused' })
	expect(presenter.receiveState({ beat: 1, status: 'paused' }, 'audience-a')).toBe(false)
	expect(presenter.receiveState(audience.playback!.getState(), audience.rehearsalId)).toBe(true)
	expect(presenter.document.title).toBe('Show B')
	expect(presenter.state).toEqual({ beat: -1, status: 'ready' })
	presenter.setConnected(false)
	presenter.setConnected(true)
	presenter.hello(audience.document, audience.rehearsalId, send)
	presenter.deliver(send)
	expect(send).toHaveBeenCalledTimes(1)
	audience.dispose()
})

it('delivers a queued show on a returning heartbeat without a hello and initializes a later fresh audience', () => {
	const presenter = new PresenterSession(sampleDocument, 'initial')
	presenter.hello(sampleDocument, 'show-a', vi.fn())
	presenter.setConnected(true)
	presenter.setConnected(false)
	presenter.rehearse({ ...sampleDocument, title: 'Heartbeat replacement' }, 'show-b')
	const send = vi.fn()
	presenter.setConnected(true)
	presenter.deliver(send)
	expect(presenter.receiveState({ beat: 0, status: 'paused' }, 'show-a')).toBe(false)
	presenter.deliver(send)
	expect(send).toHaveBeenCalledTimes(1)
	expect(send).toHaveBeenLastCalledWith(
		expect.objectContaining({ rehearsalId: 'show-b', replace: true })
	)
	presenter.receiveState({ beat: -1, status: 'ready' }, 'show-b')
	presenter.setConnected(false)
	presenter.hello(null, null, send)
	expect(send).toHaveBeenCalledTimes(2)
	expect(send).toHaveBeenLastCalledWith(
		expect.objectContaining({
			initialize: expect.objectContaining({ title: 'Heartbeat replacement' }),
			replace: false,
		})
	)
})

it('adopts an existing paused audience on presenter reload without replacing it', () => {
	const presenter = new PresenterSession(sampleDocument, 'fresh-presenter')
	const send = vi.fn()
	const existing = { ...sampleDocument, title: 'Existing audience deck' }
	presenter.hello(existing, 'existing', send)
	presenter.receiveState({ beat: 1, status: 'paused' }, 'existing')
	presenter.setConnected(true)
	presenter.setConnected(false)
	presenter.setConnected(true)
	presenter.deliver(send)
	presenter.hello(existing, 'existing', send)
	expect(send).not.toHaveBeenCalled()
	expect(presenter.document.title).toBe('Existing audience deck')
	expect(presenter.state).toEqual({ beat: 1, status: 'paused' })
})

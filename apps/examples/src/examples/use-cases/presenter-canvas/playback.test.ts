import { PreparedPlayback, type PlaybackScene } from './playback'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function rehearsal() {
	const scene: PlaybackScene = {
		durations: [100, 200],
		begin: vi.fn(),
		render: vi.fn(),
		reset: vi.fn(),
	}
	const playback = new PreparedPlayback(scene, vi.fn())
	return { scene, playback }
}

it('completes one stroke interval and holds until an explicit advance', () => {
	const { scene, playback } = rehearsal()
	playback.command('next')
	playback.command('next')
	vi.advanceTimersByTime(500)
	expect(scene.begin).toHaveBeenCalledTimes(1)
	expect(scene.render).toHaveBeenLastCalledWith(0, 100)
	expect(playback.getState()).toEqual({ beat: 0, status: 'waiting' })
	playback.command('next')
	vi.advanceTimersByTime(500)
	expect(playback.getState()).toEqual({ beat: 1, status: 'complete' })
	playback.dispose()
})

it('freezes elapsed drawing time while paused and resumes the remaining interval', () => {
	const { scene, playback } = rehearsal()
	playback.command('next')
	vi.advanceTimersByTime(40)
	playback.command('pause')
	const calls = vi.mocked(scene.render).mock.calls.length
	vi.advanceTimersByTime(1000)
	expect(scene.render).toHaveBeenCalledTimes(calls)
	expect(playback.getState()).toEqual({ beat: 0, status: 'paused' })
	playback.command('resume')
	vi.advanceTimersByTime(32)
	expect(playback.getState().status).toBe('playing')
	vi.advanceTimersByTime(40)
	expect(playback.getState()).toEqual({ beat: 0, status: 'waiting' })
	playback.dispose()
})

it('cancels pending writes on reset and replays the same elapsed frames', () => {
	const { scene, playback } = rehearsal()
	playback.command('next')
	vi.advanceTimersByTime(32)
	const first = vi.mocked(scene.render).mock.calls.slice()
	playback.command('reset')
	vi.mocked(scene.render).mockClear()
	vi.advanceTimersByTime(500)
	expect(scene.render).not.toHaveBeenCalled()
	expect(playback.getState()).toEqual({ beat: -1, status: 'ready' })
	playback.command('next')
	vi.advanceTimersByTime(32)
	expect(vi.mocked(scene.render).mock.calls).toEqual(first)
	playback.dispose()
	vi.mocked(scene.render).mockClear()
	playback.command('next')
	vi.advanceTimersByTime(500)
	expect(scene.render).not.toHaveBeenCalled()
})

export interface PlaybackState {
	beat: number
	status: 'ready' | 'playing' | 'paused' | 'waiting' | 'complete'
}

export type PlaybackCommand = 'next' | 'pause' | 'resume' | 'reset'

export interface PlaybackScene {
	durations: readonly number[]
	begin(beat: number): void
	render(beat: number, elapsed: number): void
	reset(): void
}

export class PreparedPlayback {
	private state: PlaybackState = { beat: -1, status: 'ready' }
	private elapsed = 0
	private startedAt = 0
	private timer: ReturnType<typeof setTimeout> | undefined
	private disposed = false

	constructor(
		private scene: PlaybackScene,
		private onChange: (state: PlaybackState) => void
	) {}

	getState(): PlaybackState {
		return { ...this.state }
	}

	command(command: PlaybackCommand) {
		if (this.disposed) return
		switch (command) {
			case 'next': {
				if (this.state.status !== 'ready' && this.state.status !== 'waiting') return
				const beat = this.state.beat + 1
				if (beat >= this.scene.durations.length) return
				this.elapsed = 0
				this.scene.begin(beat)
				this.setState({ beat, status: 'playing' })
				this.start()
				break
			}
			case 'pause':
				if (this.state.status !== 'playing') return
				this.elapsed += performance.now() - this.startedAt
				this.cancel()
				this.scene.render(this.state.beat, this.elapsed)
				this.setState({ ...this.state, status: 'paused' })
				break
			case 'resume':
				if (this.state.status !== 'paused') return
				this.setState({ ...this.state, status: 'playing' })
				this.start()
				break
			case 'reset':
				this.cancel()
				this.elapsed = 0
				this.scene.reset()
				this.setState({ beat: -1, status: 'ready' })
				break
		}
	}

	dispose() {
		this.disposed = true
		this.cancel()
	}

	private setState(state: PlaybackState) {
		this.state = state
		this.onChange(this.getState())
	}

	private cancel() {
		clearTimeout(this.timer)
		this.timer = undefined
	}

	private start() {
		this.startedAt = performance.now()
		const tick = () => {
			const elapsed = this.elapsed + performance.now() - this.startedAt
			const duration = this.scene.durations[this.state.beat]
			this.scene.render(this.state.beat, Math.min(elapsed, duration))
			if (elapsed >= duration) {
				this.timer = undefined
				this.setState({
					...this.state,
					status: this.state.beat === this.scene.durations.length - 1 ? 'complete' : 'waiting',
				})
			} else {
				this.timer = setTimeout(tick, 16)
			}
		}
		tick()
	}
}

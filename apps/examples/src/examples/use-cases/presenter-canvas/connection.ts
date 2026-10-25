import type { PlaybackState } from './playback'

export const audienceTimeout = 2000

function isState(value: unknown): value is PlaybackState {
	if (!value || typeof value !== 'object') return false
	return (
		'beat' in value &&
		typeof value.beat === 'number' &&
		Number.isInteger(value.beat) &&
		value.beat >= -1 &&
		value.beat < 100 &&
		'status' in value &&
		(value.status === 'ready' ||
			value.status === 'playing' ||
			value.status === 'paused' ||
			value.status === 'waiting' ||
			value.status === 'complete')
	)
}

export class PresenterConnection<Peer extends { opener: unknown; closed: boolean }> {
	audience: Peer | null = null
	private lastSeen = -Infinity

	constructor(
		private readonly presenter: unknown,
		private readonly origin: string,
		public session: string
	) {}

	attach(audience: Peer, session: string) {
		this.audience = audience
		this.session = session
		this.lastSeen = -Infinity
	}

	receive(
		event: { origin: string; source: Peer; data: unknown },
		now: number
	): PlaybackState | null {
		const { source, data } = event
		if (
			event.origin !== this.origin ||
			source.closed ||
			source.opener !== this.presenter ||
			(this.audience !== null && source !== this.audience) ||
			!data ||
			typeof data !== 'object' ||
			!('session' in data) ||
			data.session !== this.session ||
			!('presenterState' in data) ||
			!isState(data.presenterState)
		)
			return null

		// The opener survives presenter reloads; the matching session identifies its audience.
		this.audience = source
		this.lastSeen = now
		return data.presenterState
	}

	isConnected(now: number) {
		return this.audience !== null && !this.audience.closed && now - this.lastSeen < audienceTimeout
	}
}

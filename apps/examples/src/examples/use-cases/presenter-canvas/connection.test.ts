import { PresenterConnection, audienceTimeout } from './connection'

const origin = 'https://example.com'
const session = 'rehearsal-session'
const presenter = {}
const paused = { beat: 1, status: 'paused' }

function audience(opener: unknown = presenter) {
	return { opener, closed: false }
}

function message(
	source: ReturnType<typeof audience>,
	data: unknown = { session, presenterState: paused }
) {
	return { source, origin, data }
}

it('reconnects a reloaded presenter to the same audience and its existing cue', () => {
	const canvas = audience()
	const beforeReload = new PresenterConnection(presenter, origin, session)
	beforeReload.attach(canvas, session)
	expect(beforeReload.receive(message(canvas), 0)).toEqual(paused)

	const afterReload = new PresenterConnection(presenter, origin, session)
	expect(afterReload.isConnected(500)).toBe(false)
	expect(afterReload.receive(message(canvas), 500)).toEqual(paused)
	expect(afterReload.audience).toBe(canvas)
	expect(afterReload.isConnected(500)).toBe(true)
})

it('expires an open audience without acknowledgements and reconnects on a valid heartbeat', () => {
	const canvas = audience()
	const connection = new PresenterConnection(presenter, origin, session)
	connection.receive(message(canvas), 100)
	expect(connection.isConnected(100 + audienceTimeout - 1)).toBe(true)
	expect(connection.isConnected(100 + audienceTimeout)).toBe(false)
	expect(connection.audience).toBe(canvas)
	expect(connection.receive(message(canvas), 100 + audienceTimeout)).toEqual(paused)
	expect(connection.isConnected(100 + audienceTimeout)).toBe(true)
	canvas.closed = true
	expect(connection.isConnected(100 + audienceTimeout)).toBe(false)
})

it('rejects another origin, opener, or session when discovering the audience', () => {
	const canvas = audience()
	const connection = new PresenterConnection(presenter, origin, session)
	expect(connection.receive({ ...message(canvas), origin: 'https://unrelated.com' }, 0)).toBeNull()
	expect(connection.receive(message(audience({})), 0)).toBeNull()
	expect(
		connection.receive(message(canvas, { session: 'other', presenterState: paused }), 0)
	).toBeNull()
	expect(connection.audience).toBeNull()
	expect(connection.isConnected(0)).toBe(false)
})

it('pins the audience source and never lets rejected messages extend its liveness', () => {
	const canvas = audience()
	const connection = new PresenterConnection(presenter, origin, session)
	connection.receive(message(canvas), 0)
	expect(connection.receive(message(audience()), audienceTimeout - 1)).toBeNull()
	expect(
		connection.receive(
			message(canvas, { session, presenterState: { beat: 0, status: 'invalid' } }),
			audienceTimeout - 1
		)
	).toBeNull()
	expect(connection.isConnected(audienceTimeout)).toBe(false)
	expect(connection.audience).toBe(canvas)
})

it('requires a fresh acknowledgement after replacement and rejects the old session after reload', () => {
	const previous = audience()
	const replacement = audience()
	const connection = new PresenterConnection(presenter, origin, session)
	connection.receive(message(previous), 0)
	connection.attach(replacement, 'replacement-session')
	expect(connection.isConnected(1)).toBe(false)
	expect(connection.receive(message(previous), 1)).toBeNull()

	const reloaded = new PresenterConnection(presenter, origin, connection.session)
	expect(reloaded.receive(message(previous), 1)).toBeNull()
	expect(
		reloaded.receive(
			message(replacement, { session: 'replacement-session', presenterState: paused }),
			1
		)
	).toEqual(paused)
	expect(reloaded.audience).toBe(replacement)
})

it.each([
	null,
	'presenter-ping',
	{},
	{ session },
	{ session, presenterState: { beat: 100, status: 'ready' } },
])('rejects malformed audience state %j', (data) => {
	const connection = new PresenterConnection(presenter, origin, session)
	expect(connection.receive(message(audience(), data), 0)).toBeNull()
	expect(connection.audience).toBeNull()
})

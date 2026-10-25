import { useCallback, useEffect, useState } from 'react'
import { Editor, Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { PresenterConnection } from './connection'
import { PreparedPlayback, type PlaybackCommand, type PlaybackState } from './playback'
import { createPreparedScene, preparedBeats } from './prepared'
import './presenter-canvas.css'

const sessionKey = 'presenter-canvas-session'
const initialState: PlaybackState = { beat: -1, status: 'ready' }

function isCommand(value: unknown): value is PlaybackCommand {
	return value === 'next' || value === 'pause' || value === 'resume' || value === 'reset'
}

export default function PresenterCanvasExample() {
	const audience = new URLSearchParams(window.location.search).get('audience') === '1'
	return audience ? <AudienceCanvas /> : <Presenter />
}

function AudienceCanvas() {
	const [editor, setEditor] = useState<Editor | null>(null)
	useEffect(() => {
		if (!editor) return
		const opener = window.opener
		const session = new URLSearchParams(window.location.search).get('session')
		const publish = (state: PlaybackState) =>
			opener?.postMessage({ presenterState: state, session }, window.location.origin)
		const playback = new PreparedPlayback(createPreparedScene(editor), publish)
		const receive = (event: MessageEvent<unknown>) => {
			if (event.origin !== window.location.origin || event.source !== opener || !opener) return
			if (event.data === 'presenter-ping') publish(playback.getState())
			else if (isCommand(event.data)) playback.command(event.data)
		}
		window.addEventListener('message', receive)
		publish(playback.getState())
		const heartbeat = setInterval(() => publish(playback.getState()), 500)
		return () => {
			clearInterval(heartbeat)
			window.removeEventListener('message', receive)
			playback.dispose()
		}
	}, [editor])

	return (
		<div className="tldraw__editor presenter-audience">
			<Tldraw
				hideUi
				onMount={(editor) => {
					editor.setCameraOptions({
						isLocked: true,
						constraints: {
							bounds: { x: 0, y: 0, w: 900, h: 680 },
							behavior: 'contain',
							initialZoom: 'fit-max',
							baseZoom: 'fit-max',
							origin: { x: 0.5, y: 0.5 },
							padding: { x: 24, y: 24 },
						},
					})
					editor.setCurrentTool('select')
					setEditor(editor)
				}}
			/>
		</div>
	)
}

function Presenter() {
	const [connection] = useState(() => {
		const session = sessionStorage.getItem(sessionKey) ?? crypto.randomUUID()
		sessionStorage.setItem(sessionKey, session)
		return new PresenterConnection<Window>(window, window.location.origin, session)
	})
	const [connected, setConnected] = useState(false)
	const [error, setError] = useState('')
	const [state, setState] = useState<PlaybackState>(initialState)
	const send = useCallback(
		(command: PlaybackCommand) => connection.audience?.postMessage(command, window.location.origin),
		[connection]
	)

	useEffect(() => {
		const receive = (event: MessageEvent<unknown>) => {
			if (!event.source || !('opener' in event.source)) return
			const state = connection.receive(
				{ origin: event.origin, source: event.source, data: event.data },
				Date.now()
			)
			if (!state) return
			setState(state)
			setConnected(true)
		}
		const pauseOnExit = () => connection.audience?.postMessage('pause', window.location.origin)
		window.addEventListener('pagehide', pauseOnExit)
		window.addEventListener('message', receive)
		const timer = setInterval(() => {
			setConnected(connection.isConnected(Date.now()))
			if (connection.audience?.closed) connection.audience = null
			else connection.audience?.postMessage('presenter-ping', window.location.origin)
		}, 500)
		return () => {
			window.removeEventListener('message', receive)
			window.removeEventListener('pagehide', pauseOnExit)
			clearInterval(timer)
			connection.audience?.postMessage('pause', window.location.origin)
		}
	}, [connection])

	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (!connected || event.repeat || event.altKey || event.metaKey || event.ctrlKey) return
			const target = event.target
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
			)
				return
			if (event.code === 'Space' && target instanceof HTMLButtonElement) return
			if (event.code === 'ArrowRight' || event.code === 'Space') {
				event.preventDefault()
				send('next')
			} else if (event.code === 'KeyP') {
				event.preventDefault()
				send(state.status === 'paused' ? 'resume' : 'pause')
			}
		}
		window.addEventListener('keydown', keydown)
		return () => window.removeEventListener('keydown', keydown)
	}, [connected, state.status, send])

	function openAudience() {
		if (connection.isConnected(Date.now()) && connection.audience) {
			connection.audience.focus()
			return
		}
		const url = new URL('/presenter-canvas/full', window.location.origin)
		url.searchParams.set('audience', '1')
		const session = crypto.randomUUID()
		url.searchParams.set('session', session)
		const opened = window.open(url, '_blank', 'popup,width=1200,height=850')
		if (opened) {
			connection.attach(opened, session)
			sessionStorage.setItem(sessionKey, session)
		}
		setConnected(false)
		setState(initialState)
		setError(opened ? '' : 'The audience window was blocked. Allow pop-ups, then try again.')
	}

	const canAdvance = connected && (state.status === 'ready' || state.status === 'waiting')
	const currentBeat = preparedBeats[state.beat]
	const nextBeat = preparedBeats[state.beat + 1]
	return (
		<div className="tldraw__editor presenter-controller">
			<main className="presenter-desk">
				<header>
					<h1>A request takes a round trip</h1>
					<p>A prepared drawing rehearsal. You narrate; the canvas follows your cues.</p>
				</header>
				<section className="presenter-output" aria-label="Audience window">
					<div>
						<strong>
							{connected
								? 'Audience window connected'
								: connection.audience
									? 'Audience window disconnected'
									: 'Open the audience canvas first'}
						</strong>
						<p>Share only that window in your call. Keep this presenter view for yourself.</p>
						{!connected && connection.audience && (
							<p>Replacement opens a fresh rehearsal. The previous window stays untouched.</p>
						)}
					</div>
					<button onClick={openAudience}>
						{connected
							? 'Focus audience window'
							: connection.audience
								? 'Open replacement audience'
								: 'Open audience window'}
					</button>
				</section>
				{error && <p role="alert">{error}</p>}
				<div className="presenter-rehearsal">
					<section className="presenter-cue" aria-label="Current cue">
						<p className="presenter-status" role="status">
							{!connected
								? 'Waiting for audience window'
								: {
										ready: 'Ready for the first beat',
										playing: 'Drawing…',
										paused: 'Playback paused',
										waiting: 'Holding for your next cue',
										complete: 'Explanation complete',
									}[state.status]}
						</p>
						<h2>{currentBeat?.title ?? 'Tell the story one beat at a time'}</h2>
						<p>
							{currentBeat?.note ??
								'Three short sequences build the diagram. Each beat stops automatically so you can explain at your own pace.'}
						</p>
						<div className="presenter-actions">
							<button
								className="presenter-next"
								disabled={!canAdvance}
								onClick={() => send('next')}
							>
								{state.beat === -1 ? 'Start first beat' : 'Next beat'}
							</button>
							<button
								disabled={!connected || (state.status !== 'playing' && state.status !== 'paused')}
								onClick={() => send(state.status === 'paused' ? 'resume' : 'pause')}
							>
								{state.status === 'paused' ? 'Resume' : 'Pause'}
							</button>
							<button
								disabled={!connected || state.status === 'ready'}
								onClick={() => send('reset')}
							>
								Reset to start
							</button>
						</div>
						<p className="presenter-keys">
							In this view: <kbd>Space</kbd> / <kbd>→</kbd> next beat · <kbd>P</kbd> pause or resume
						</p>
						{nextBeat && <p className="presenter-up-next">Up next: {nextBeat.title}</p>}
					</section>
					<nav aria-label="Prepared beats">
						<ol className="presenter-beats">
							{preparedBeats.map((beat, index) => (
								<li key={beat.title} aria-current={state.beat === index ? 'step' : undefined}>
									<span>{index + 1}</span>
									<div>
										<strong>{beat.title}</strong>
										<p>{beat.duration / 1000}s of drawing, then hold</p>
									</div>
								</li>
							))}
						</ol>
					</nav>
				</div>
				<footer>
					Prepared sample strokes · No AI requests or microphone · Reset, then start to replay
				</footer>
			</main>
		</div>
	)
}

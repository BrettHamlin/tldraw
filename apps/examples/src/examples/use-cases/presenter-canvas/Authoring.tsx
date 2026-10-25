import { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, Tldraw } from 'tldraw'
import { installAiAuthoringBridge } from './ai-bridge'
import { usePresenterMcp } from './ai-mcp-client'
import { DrawingPreview } from './ai-preview'
import { captureDrawShape } from './capture'
import {
	beatDuration,
	importPresentation,
	libraryKey,
	parsePresentation,
	restoreLibrary,
	savePresentation,
	type PresentationDocument,
	type PresentationLibrary,
} from './document'
import { sampleDocument } from './prepared'

export interface AuthoringProps {
	onRehearse(document: PresentationDocument): string
	activeRehearsalId: string | null
}
export function Authoring({ onRehearse, activeRehearsalId }: AuthoringProps) {
	const [library, setLibrary] = useState<PresentationLibrary>({
		version: 1,
		current: sampleDocument,
		saved: [],
	})
	const [loaded, setLoaded] = useState(false)
	const [error, setError] = useState('')
	const [selected, setSelected] = useState(0)
	const [savedId, setSavedId] = useState('')
	const [json, setJson] = useState('')
	const [editor, setEditor] = useState<Editor | null>(null)
	const [text, setText] = useState('')
	const [duration, setDuration] = useState(1000)
	const download = useRef<HTMLAnchorElement>(null)
	const doc = library.current
	const beat = doc.beats[selected] ?? doc.beats[0]
	const index = doc.beats.indexOf(beat)
	useEffect(() => {
		if (!editor) return
		editor.setCameraOptions({
			constraints: {
				bounds: { x: 0, y: 0, w: doc.canvas.width, h: doc.canvas.height },
				behavior: 'contain',
				initialZoom: 'fit-max',
				baseZoom: 'fit-max',
				origin: { x: 0.5, y: 0.5 },
				padding: { x: 32, y: 32 },
			},
		})
	}, [editor, doc.canvas.width, doc.canvas.height])
	useEffect(() => {
		try {
			const saved = localStorage.getItem(libraryKey)
			if (saved) setLibrary(restoreLibrary(saved))
		} catch (e) {
			setError(
				`Could not restore saved presentations: ${e instanceof Error ? e.message : 'Storage unavailable'}`
			)
		}
		setLoaded(true)
	}, [])
	useEffect(() => {
		if (!loaded) return
		try {
			localStorage.setItem(libraryKey, JSON.stringify(library))
		} catch {
			setError('Changes could not be saved locally. Export JSON to keep a copy.')
		}
	}, [library, loaded])
	const applyValidatedDocument = useCallback((document: PresentationDocument) => {
		setLibrary((l) => ({ ...l, current: document }))
		setSelected(0)
		setSavedId('')
		setError('')
	}, [])
	const mcp = usePresenterMcp({
		getDocument: () => doc,
		replaceDocument: applyValidatedDocument,
		getRehearsalId: () => activeRehearsalId,
	})
	useEffect(
		() =>
			installAiAuthoringBridge({ getDocument: () => doc, replaceDocument: applyValidatedDocument }),
		[doc, applyValidatedDocument]
	)
	function applyDocument(value: unknown) {
		try {
			applyValidatedDocument(parsePresentation(value))
			return true
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Invalid presentation')
			return false
		}
	}
	function update(document: PresentationDocument) {
		try {
			const current = parsePresentation(document)
			setLibrary((l) => ({ ...l, current }))
			setError('')
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Invalid presentation')
		}
	}
	function updateBeat(next: typeof beat) {
		update({ ...doc, beats: doc.beats.map((b, i) => (i === index ? next : b)) })
	}
	function capture() {
		if (!editor) return
		const strokes = editor.getCurrentPageShapesSorted().filter((s) => s.type === 'draw')
		const actions = [...beat.actions]
		for (const shape of strokes) {
			if (shape.type !== 'draw') continue
			const points = captureDrawShape(shape, editor.getShapePageTransform(shape))
			const color = shape.props.color
			actions.push({
				kind: 'stroke',
				color: color === 'blue' || color === 'green' || color === 'red' ? color : 'black',
				start: Math.max(0, ...actions.map((a) => a.start + a.duration)),
				duration,
				points,
			})
		}
		try {
			const current = parsePresentation({
				...doc,
				beats: doc.beats.map((b, i) => (i === index ? { ...b, actions } : b)),
			})
			update(current)
			editor.deleteShapes(strokes.map((s) => s.id))
		} catch (e) {
			setError(`Drawing was kept: ${e instanceof Error ? e.message : 'Invalid stroke'}`)
		}
	}
	function move(direction: number) {
		const target = index + direction
		if (target < 0 || target >= doc.beats.length) return
		const beats = [...doc.beats]
		;[beats[index], beats[target]] = [beats[target], beats[index]]
		update({ ...doc, beats })
		setSelected(target)
	}
	function exportJson() {
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
		)
		if (download.current) {
			download.current.href = url
			download.current.download = `${doc.title}.json`
			download.current.click()
		}
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	return (
		<section className="presenter-authoring" aria-label="Presentation authoring">
			<h2>Prepare your presentation</h2>
			<p>
				Ask Codex to draw with tldraw MCP. Preview the result here, then choose Rehearse this deck.
				Your active audience stays unchanged while you prepare.
			</p>
			<div className="presenter-fields">
				<label>
					Presentation title
					<input value={doc.title} onChange={(e) => update({ ...doc, title: e.target.value })} />
				</label>
				<label>
					Saved presentations
					<select
						value={savedId}
						onChange={(e) => {
							const saved = library.saved.find((s) => s.id === e.target.value)
							if (saved) {
								update(saved.document)
								setSavedId(saved.id)
								setSelected(0)
							}
						}}
					>
						<option value="">Choose a saved presentation</option>
						{library.saved.map((s) => (
							<option key={s.id} value={s.id}>
								{s.document.title}
							</option>
						))}
					</select>
				</label>
			</div>
			<div className="presenter-actions">
				<button
					onClick={() => {
						const id = savedId || crypto.randomUUID()
						setLibrary(savePresentation(library, id))
						setSavedId(id)
					}}
				>
					Save presentation
				</button>
				<button
					onClick={() => {
						setLibrary(savePresentation(library, crypto.randomUUID()))
						setSavedId('')
					}}
				>
					Save a copy
				</button>
				<button
					onClick={() =>
						applyDocument({
							version: 1,
							title: 'Untitled presentation',
							canvas: { width: 900, height: 680 },
							beats: [{ id: crypto.randomUUID(), title: 'First beat', note: '', actions: [] }],
						})
					}
				>
					New presentation
				</button>
				<button
					onClick={() => {
						const document = parsePresentation(doc)
						const id = onRehearse(document)
						mcp.markRehearsal(id, document)
					}}
				>
					Rehearse this deck
				</button>
			</div>
			<p role="status">{mcp.message}</p>
			<DrawingPreview document={doc} />
			<details>
				<summary>AI authoring with Codex</summary>
				<p>
					Ask Codex: “Use tldraw presenter to draw an explanation in three beats.” You can ask for
					revisions in the same conversation.
				</p>
				<p>
					Codex uses the dedicated tldraw MCP tools. This page receives the drawing automatically.
					Choose Rehearse this deck when it is ready.
				</p>
			</details>
			{error && <p role="alert">{error}</p>}
			<details>
				<summary>Edit beats and drawings</summary>
				<div className="presenter-authoring-grid">
					<nav aria-label="Edit beats">
						<ol className="presenter-beats">
							{doc.beats.map((b, i) => (
								<li key={b.id}>
									<button aria-pressed={i === index} onClick={() => setSelected(i)}>
										{i + 1}. {b.title}
									</button>
								</li>
							))}
						</ol>
						<button
							onClick={() => {
								update({
									...doc,
									beats: [
										...doc.beats,
										{
											id: crypto.randomUUID(),
											title: `Beat ${doc.beats.length + 1}`,
											note: '',
											actions: [],
										},
									],
								})
								setSelected(doc.beats.length)
							}}
						>
							Add beat
						</button>
					</nav>
					<div className="presenter-fields">
						<label>
							Beat title
							<input
								value={beat.title}
								onChange={(e) => updateBeat({ ...beat, title: e.target.value })}
							/>
						</label>
						<label>
							Presenter cue
							<textarea
								value={beat.note}
								onChange={(e) => updateBeat({ ...beat, note: e.target.value })}
							/>
						</label>
						<div className="presenter-actions">
							<button disabled={index === 0} onClick={() => move(-1)}>
								Move earlier
							</button>
							<button disabled={index === doc.beats.length - 1} onClick={() => move(1)}>
								Move later
							</button>
							<button
								disabled={doc.beats.length === 1}
								onClick={() => {
									update({ ...doc, beats: doc.beats.filter((_, i) => i !== index) })
									setSelected(Math.max(0, index - 1))
								}}
							>
								Delete beat
							</button>
						</div>
						<p>
							{beat.actions.length} actions · {(beatDuration(beat) / 1000).toFixed(1)}s, then hold
						</p>
						<label>
							Stroke duration (milliseconds)
							<input
								type="number"
								min="1"
								max="600000"
								value={duration}
								onChange={(e) =>
									setDuration(Math.max(1, Math.min(600000, Number(e.target.value) || 1)))
								}
							/>
						</label>
						<label>
							Text to add
							<input value={text} onChange={(e) => setText(e.target.value)} />
						</label>
						<button
							disabled={!text.trim()}
							onClick={() => {
								updateBeat({
									...beat,
									actions: [
										...beat.actions,
										{
											kind: 'text',
											text,
											x: 40,
											y: Math.min(
												doc.canvas.height - 40,
												40 + beat.actions.filter((a) => a.kind === 'text').length * 50
											),
											start: beat.actions.length ? beatDuration(beat) : 0,
											duration: 1,
										},
									],
								})
								setText('')
							}}
						>
							Append text
						</button>
						<ol className="presenter-action-list">
							{beat.actions.map((a, i) => (
								<li key={i}>
									<span>{a.kind === 'text' ? 'Text' : `Stroke (${a.points.length} points)`}</span>
									{a.kind === 'text' && (
										<>
											<label>
												Text
												<input
													value={a.text}
													onChange={(e) =>
														updateBeat({
															...beat,
															actions: beat.actions.map((action, j) =>
																j === i ? { ...a, text: e.target.value } : action
															),
														})
													}
												/>
											</label>
											<label>
												X
												<input
													type="number"
													value={a.x}
													onChange={(e) =>
														updateBeat({
															...beat,
															actions: beat.actions.map((action, j) =>
																j === i ? { ...a, x: Number(e.target.value) } : action
															),
														})
													}
												/>
											</label>
											<label>
												Y
												<input
													type="number"
													value={a.y}
													onChange={(e) =>
														updateBeat({
															...beat,
															actions: beat.actions.map((action, j) =>
																j === i ? { ...a, y: Number(e.target.value) } : action
															),
														})
													}
												/>
											</label>
										</>
									)}
									<label>
										Start ms
										<input
											type="number"
											min="0"
											value={a.start}
											onChange={(e) =>
												updateBeat({
													...beat,
													actions: beat.actions.map((action, j) =>
														j === i ? { ...action, start: Number(e.target.value) } : action
													),
												})
											}
										/>
									</label>
									<label>
										Duration ms
										<input
											type="number"
											min="1"
											value={a.duration}
											onChange={(e) =>
												updateBeat({
													...beat,
													actions: beat.actions.map((action, j) =>
														j === i ? { ...action, duration: Number(e.target.value) } : action
													),
												})
											}
										/>
									</label>
									<button
										onClick={() =>
											updateBeat({ ...beat, actions: beat.actions.filter((_, j) => j !== i) })
										}
									>
										Remove action {i + 1}
									</button>
								</li>
							))}
						</ol>
					</div>
				</div>
				<h3>Draw the next strokes</h3>
				<p>
					Scratch canvas · {doc.canvas.width} × {doc.canvas.height}. Use the native pen tool.
					Capture into “{beat.title}” when ready.
				</p>
				<div className="presenter-scratch">
					<Tldraw
						onMount={(e) => {
							e.setCurrentTool('draw')
							setEditor(e)
						}}
					/>
				</div>
				<div className="presenter-actions">
					<button onClick={capture}>Capture strokes into selected beat</button>
					<button onClick={() => editor?.deleteShapes([...editor.getCurrentPageShapeIds()])}>
						Clear scratch canvas
					</button>
				</div>
				<details>
					<summary>Import or export presentation JSON</summary>
					<p>Import validates the whole document. Invalid input keeps your current presentation.</p>
					<label>
						Presentation JSON
						<textarea
							className="presenter-json"
							value={json}
							onChange={(e) => setJson(e.target.value)}
						/>
					</label>
					<div className="presenter-actions">
						<button
							onClick={() => {
								const result = importPresentation(json, doc)
								if (result.error) setError(result.error)
								else applyDocument(result.document)
							}}
						>
							Import JSON
						</button>
						<button onClick={exportJson}>Export JSON</button>
						<button onClick={() => setJson(JSON.stringify(sampleDocument, null, 2))}>
							Show sample JSON
						</button>
					</div>
				</details>
			</details>
			<a ref={download} hidden />
		</section>
	)
}

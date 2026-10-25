import { useEffect, useState } from 'react'
import { Editor, Tldraw } from 'tldraw'
import { beatDuration, type PresentationDocument } from './document'
import { createPreparedScene } from './prepared'

declare global {
	interface Window {
		tldrawPresenterPreview?: { exportSvg(): ReturnType<Editor['getSvgString']> }
	}
}

export function DrawingPreview({ document }: { document: PresentationDocument }) {
	const [editor, setEditor] = useState<Editor | null>(null)
	useEffect(() => {
		if (!editor) return
		const inspection = {
			exportSvg: () => editor.getSvgString([...editor.getCurrentPageShapeIds()], { padding: 24 }),
		}
		window.tldrawPresenterPreview = inspection
		return () => {
			if (window.tldrawPresenterPreview === inspection) delete window.tldrawPresenterPreview
		}
	}, [editor])
	useEffect(() => {
		if (!editor) return
		editor.setCameraOptions({
			isLocked: true,
			zoomSteps: [1],
			constraints: {
				bounds: { x: 0, y: 0, w: document.canvas.width, h: document.canvas.height },
				behavior: 'contain',
				initialZoom: 'fit-max',
				baseZoom: 'fit-max',
				origin: { x: 0.5, y: 0.5 },
				padding: { x: 24, y: 24 },
			},
		})
		editor.zoomToBounds(
			{ x: 0, y: 0, w: document.canvas.width, h: document.canvas.height },
			{ force: true, inset: 48, immediate: true }
		)
		const scene = createPreparedScene(editor, document)
		const updatePreview = (update: () => void) => {
			editor.updateInstanceState({ isReadonly: false })
			try {
				update()
			} finally {
				editor.updateInstanceState({ isReadonly: true })
			}
		}
		updatePreview(() => {
			for (const [index, beat] of document.beats.entries()) {
				scene.begin(index)
				scene.render(index, beatDuration(beat))
			}
		})
		return () => updatePreview(() => scene.reset())
	}, [editor, document])
	return (
		<div
			aria-label="Drawing preview"
			style={{
				position: 'relative',
				width: '100%',
				aspectRatio: `${document.canvas.width} / ${document.canvas.height}`,
				minHeight: 260,
				border: '1px solid #d5d5d3',
				borderRadius: 6,
				overflow: 'hidden',
			}}
		>
			<Tldraw
				hideUi
				autoFocus={false}
				onMount={(editor) => {
					editor.updateInstanceState({ isReadonly: true })
					setEditor(editor)
				}}
			/>
		</div>
	)
}

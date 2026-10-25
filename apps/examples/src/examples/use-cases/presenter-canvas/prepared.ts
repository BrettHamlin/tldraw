import { b64Vecs, createShapeId, toRichText } from 'tldraw'
import type { Editor, TLDefaultColorStyle, TLDrawShape, VecModel } from 'tldraw'
import {
	beatDuration,
	parsePresentation,
	type PresentationDocument,
	type PresentationAction,
} from './document'
import type { PlaybackScene } from './playback'

interface Stroke {
	id: string
	color: TLDefaultColorStyle
	start: number
	duration: number
	points: VecModel[]
}

interface Beat {
	title: string
	note: string
	duration: number
	labels: { text: string; x: number; y: number }[]
	strokes: Stroke[]
}

function path(vertices: [number, number][]): VecModel[] {
	return vertices.flatMap(([x, y], index) => {
		const next = vertices[index + 1]
		if (!next) return [{ x, y, z: 0.18 }]
		return Array.from({ length: 18 }, (_, step) => {
			const t = step / 18
			const progress = (index + t) / (vertices.length - 1)
			return {
				x: x + (next[0] - x) * t,
				y: y + (next[1] - y) * t,
				z: 0.2 + 0.65 * Math.sin(Math.PI * progress),
			}
		})
	})
}

function stroke(
	id: string,
	vertices: [number, number][],
	start: number,
	duration: number,
	color: TLDefaultColorStyle = 'black'
): Stroke {
	return { id, points: path(vertices), start, duration, color }
}

const preparedBeats: Beat[] = [
	{
		title: 'Start with a request',
		note: 'A browser asks a server for a page. Let the request land before explaining the return trip.',
		duration: 2400,
		labels: [
			{ text: 'A request takes a round trip', x: 80, y: 65 },
			{ text: 'Browser', x: 112, y: 240 },
		],
		strokes: [
			stroke(
				'browser',
				[
					[90, 205],
					[250, 205],
					[250, 335],
					[90, 335],
					[90, 205],
				],
				200,
				1500
			),
		],
	},
	{
		title: 'Make the round trip',
		note: 'The server does the work and sends a response back. Pause here to describe the waiting time.',
		duration: 4800,
		labels: [
			{ text: 'Server', x: 642, y: 240 },
			{ text: 'request', x: 390, y: 175 },
			{ text: 'response', x: 380, y: 355 },
		],
		strokes: [
			stroke(
				'server',
				[
					[620, 205],
					[800, 205],
					[800, 335],
					[620, 335],
					[620, 205],
				],
				100,
				1100
			),
			stroke(
				'request',
				[
					[270, 235],
					[400, 215],
					[600, 235],
					[580, 217],
				],
				1400,
				1000,
				'blue'
			),
			stroke(
				'response',
				[
					[600, 315],
					[430, 340],
					[270, 315],
					[292, 305],
				],
				3100,
				1100,
				'blue'
			),
		],
	},
	{
		title: 'Keep a copy nearby',
		note: 'A cache keeps a reusable copy closer to the browser. A later request can reuse that copy instead of making the full round trip.',
		duration: 4200,
		labels: [
			{ text: 'Cache', x: 370, y: 455 },
			{ text: 'Reuse the nearby copy', x: 80, y: 565 },
		],
		strokes: [
			stroke(
				'cache',
				[
					[330, 420],
					[490, 420],
					[490, 520],
					[330, 520],
					[330, 420],
				],
				150,
				1000,
				'green'
			),
			stroke(
				'cache-link',
				[
					[185, 355],
					[215, 470],
					[310, 470],
					[292, 455],
				],
				1600,
				1000,
				'green'
			),
			stroke(
				'underline',
				[
					[80, 610],
					[250, 614],
					[480, 610],
				],
				3000,
				800,
				'green'
			),
		],
	},
]

export function strokeProps(stroke: Stroke, progress: number) {
	const count = Math.max(1, Math.ceil(stroke.points.length * Math.min(1, progress)))
	return {
		fill: 'none',
		isClosed: false,
		scale: 1,
		scaleX: 1,
		scaleY: 1,
		color: stroke.color,
		dash: 'draw',
		size: 'm',
		isPen: true,
		isComplete: progress >= 1,
		segments: [{ type: 'free', path: b64Vecs.encodePoints(stroke.points.slice(0, count)), dim: 3 }],
	} satisfies Partial<TLDrawShape['props']>
}

export const sampleDocument = parsePresentation({
	version: 1,
	title: 'A request takes a round trip',
	canvas: { width: 900, height: 680 },
	beats: preparedBeats.map((beat, i) => ({
		id: `beat-${i}`,
		title: beat.title,
		note: beat.note,
		actions: [
			...beat.labels.map((label) => ({ kind: 'text', ...label, start: 0, duration: 1 })),
			...beat.strokes.map((stroke) => ({
				kind: 'stroke',
				color: stroke.color,
				start: stroke.start,
				duration: stroke.duration,
				points: stroke.points.map((p) => ({ x: p.x, y: p.y, pressure: (p.z ?? 0.5) / 1.25 })),
			})),
		],
	})),
})

export function documentStrokeProps(
	action: Extract<PresentationAction, { kind: 'stroke' }>,
	progress: number
) {
	return strokeProps(
		{
			id: '',
			color: action.color,
			start: action.start,
			duration: action.duration,
			points: action.points.map((p) => ({ x: p.x, y: p.y, z: p.pressure * 1.25 })),
		},
		progress
	)
}

export function createPreparedScene(
	editor: Pick<Editor, 'run' | 'getShape' | 'createShape' | 'updateShape' | 'deleteShapes'>,
	document: PresentationDocument = sampleDocument
): PlaybackScene {
	const doc = parsePresentation(document)
	const rendered = new Map<string, string>()
	const idFor = (beat: number, action: number) => createShapeId(`presenter-${beat}-${action}`)
	const ids = doc.beats.flatMap((beat, i) => beat.actions.map((_, j) => idFor(i, j)))
	return {
		durations: doc.beats.map(beatDuration),
		begin() {},
		render(index, elapsed) {
			editor.run(
				() => {
					for (const [j, action] of doc.beats[index].actions.entries()) {
						if (elapsed < action.start) continue
						const id = idFor(index, j)
						if (action.kind === 'text') {
							if (!editor.getShape(id))
								editor.createShape({
									id,
									type: 'text',
									x: action.x,
									y: action.y,
									props: { richText: toRichText(action.text), font: 'draw', size: 'm' },
								})
							continue
						}
						const progress = Math.min(1, (elapsed - action.start) / action.duration)
						const frame = `${Math.ceil(progress * action.points.length)}:${progress >= 1}`
						if (rendered.get(id) === frame) continue
						rendered.set(id, frame)
						const props = documentStrokeProps(action, progress)
						if (editor.getShape(id)) editor.updateShape<TLDrawShape>({ id, type: 'draw', props })
						else editor.createShape<TLDrawShape>({ id, type: 'draw', x: 0, y: 0, props })
					}
				},
				{ history: 'ignore' }
			)
		},
		reset() {
			rendered.clear()
			editor.run(() => editor.deleteShapes(ids), { history: 'ignore' })
		},
	}
}

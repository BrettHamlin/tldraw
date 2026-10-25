import { b64Vecs, createShapeId, toRichText } from 'tldraw'
import type { Editor, TLDefaultColorStyle, TLDrawShape, VecModel } from 'tldraw'
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

export const preparedBeats: Beat[] = [
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
		note: 'A cache keeps a reusable copy closer to the browser. This is prepared sample content; AI authoring comes later.',
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

export function createPreparedScene(editor: Editor): PlaybackScene {
	const rendered = new Map<string, string>()
	const ids = preparedBeats.flatMap((beat, index) => [
		...beat.strokes.map((stroke) => createShapeId(`presenter-${stroke.id}`)),
		...beat.labels.map((_, label) => createShapeId(`presenter-label-${index}-${label}`)),
	])
	return {
		durations: preparedBeats.map((beat) => beat.duration),
		begin(index) {
			editor.run(
				() => {
					for (const [label, { text, x, y }] of preparedBeats[index].labels.entries()) {
						editor.createShape({
							id: createShapeId(`presenter-label-${index}-${label}`),
							type: 'text',
							x,
							y,
							props: {
								richText: toRichText(text),
								size: index === 0 && label === 0 ? 'l' : 'm',
								font: 'draw',
							},
						})
					}
				},
				{ history: 'ignore' }
			)
		},
		render(index, elapsed) {
			editor.run(
				() => {
					for (const stroke of preparedBeats[index].strokes) {
						if (elapsed < stroke.start) continue
						const progress = Math.min(1, (elapsed - stroke.start) / stroke.duration)
						const frame = `${Math.ceil(progress * stroke.points.length)}:${progress >= 1}`
						if (rendered.get(stroke.id) === frame) continue
						rendered.set(stroke.id, frame)
						const id = createShapeId(`presenter-${stroke.id}`)
						const props = strokeProps(stroke, progress)
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

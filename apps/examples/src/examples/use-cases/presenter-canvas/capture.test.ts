import {
	b64Vecs,
	createShapeId,
	DrawShapeUtil,
	getIndexAbove,
	Mat,
	PageRecordType,
	type TLDrawShape,
} from 'tldraw'
import { captureDrawShape } from './capture'
import { parsePresentation } from './document'
import { documentStrokeProps, sampleDocument } from './prepared'

function nativeDraw(type: 'free' | 'straight', isPen = true): TLDrawShape {
	return {
		id: createShapeId('capture'),
		typeName: 'shape',
		type: 'draw',
		parentId: PageRecordType.createId('page'),
		index: getIndexAbove(),
		x: 0,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			...DrawShapeUtil.prototype.getDefaultProps(),
			isPen,
			scaleX: 2,
			scaleY: 0.5,
			segments: [
				{
					type,
					dim: 3,
					path: b64Vecs.encodePoints([
						{ x: 0, y: 0, z: 1.125 },
						{ x: 200, y: 100, z: 1.125 },
					]),
				},
			],
		},
	}
}

it('round trips actual encoded firm pen pressure through bounded document pressure and playback', () => {
	const shape = nativeDraw('free')
	expect(b64Vecs.decodePoints(shape.props.segments[0].path, 3)[0].z).toBe(1.125)
	const points = captureDrawShape(shape, Mat.Translate(20, 30))
	expect(points).toEqual([
		{ x: 20, y: 30, pressure: 0.9 },
		{ x: 420, y: 80, pressure: 0.9 },
	])
	const action = {
		kind: 'stroke',
		color: 'black',
		start: 0,
		duration: 1000,
		points,
	} satisfies Parameters<typeof documentStrokeProps>[0]
	const doc = parsePresentation({
		...sampleDocument,
		beats: [{ ...sampleDocument.beats[0], actions: [action] }],
	})
	expect(doc.beats[0].actions[0]).toEqual(action)
	const playback = documentStrokeProps(action, 1)
	expect(b64Vecs.decodePoints(playback.segments[0].path, 3).map((p) => p.z)).toEqual([1.125, 1.125])
})

it('expands native Shift straight segments before page transformation and progressive playback', () => {
	const points = captureDrawShape(nativeDraw('straight'), Mat.Translate(20, 30).rotate(Math.PI / 2))
	expect(points.length).toBeGreaterThan(20)
	expect(points[0].x).toBeCloseTo(20)
	expect(points[0].y).toBeCloseTo(30)
	expect(points.at(-1)?.x).toBeCloseTo(-30)
	expect(points.at(-1)?.y).toBeCloseTo(430)
	const action = {
		kind: 'stroke',
		color: 'black',
		start: 0,
		duration: 1000,
		points,
	} satisfies Parameters<typeof documentStrokeProps>[0]
	const tips = [0.25, 0.5, 0.75, 1].map((progress) => {
		const props = documentStrokeProps(action, progress)
		return b64Vecs.decodePoints(props.segments[0].path, 3).at(-1)!
	})
	expect(tips[0].y).toBeGreaterThan(30)
	expect(tips[1].y).toBeGreaterThan(tips[0].y)
	expect(tips[2].y).toBeGreaterThan(tips[1].y)
	expect(tips[3].y).toBeGreaterThan(tips[2].y)
	for (let i = 1; i < points.length; i++) {
		expect(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)).toBeLessThan(
			60
		)
	}
})

it('uses neutral pressure for native mouse strokes', () => {
	expect(
		captureDrawShape(nativeDraw('free', false), Mat.Identity()).map((p) => p.pressure)
	).toEqual([0.5, 0.5])
})

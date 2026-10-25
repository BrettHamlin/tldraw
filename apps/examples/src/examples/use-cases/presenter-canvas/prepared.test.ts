import { b64Vecs, createShapeId, createTLStore, defaultShapeUtils, getIndexAbove } from 'tldraw'
import { preparedBeats, strokeProps } from './prepared'

it('extends a native pressure-aware stroke, then marks it complete', () => {
	const stroke = preparedBeats[0].strokes[0]
	const early = strokeProps(stroke, 0.25)
	const complete = strokeProps(stroke, 1)
	const earlyPoints = b64Vecs.decodePoints(early.segments[0].path, 3)
	const completePoints = b64Vecs.decodePoints(complete.segments[0].path, 3)
	expect(earlyPoints.length).toBeLessThan(completePoints.length)
	expect(earlyPoints).toEqual(completePoints.slice(0, earlyPoints.length))
	expect(early).toMatchObject({ isPen: true, isComplete: false, dash: 'draw' })
	expect(complete).toMatchObject({ isPen: true, isComplete: true })
	expect(Math.max(...completePoints.map((point) => point.z ?? 0))).toBeGreaterThan(0.8)
	expect(Math.min(...completePoints.map((point) => point.z ?? 0))).toBeLessThan(0.25)
})

it('accepts the progressive and complete pressure strokes in the native draw schema', () => {
	const store = createTLStore({ shapeUtils: defaultShapeUtils })
	for (const progress of [0.25, 1]) {
		const shape = store.schema.types.shape.validator.validate({
			id: createShapeId('pressure-proof'),
			typeName: 'shape',
			type: 'draw',
			parentId: 'page:page',
			index: getIndexAbove(),
			x: 0,
			y: 0,
			rotation: 0,
			isLocked: false,
			opacity: 1,
			meta: {},
			props: strokeProps(preparedBeats[0].strokes[0], progress),
		})
		expect(shape).toMatchObject({ typeName: 'shape', type: 'draw' })
	}
})

import { b64Vecs, createShapeId, createTLStore, defaultShapeUtils, getIndexAbove } from 'tldraw'
import { parsePresentation } from './document'
import { createPreparedScene, documentStrokeProps, sampleDocument } from './prepared'

it('extends a native pressure-aware stroke, then marks it complete', () => {
	const stroke = sampleDocument.beats[0].actions.find((a) => a.kind === 'stroke')
	if (!stroke || stroke.kind !== 'stroke') throw new Error('Sample stroke missing')
	const early = documentStrokeProps(stroke, 0.25)
	const complete = documentStrokeProps(stroke, 1)
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
	const stroke = sampleDocument.beats[0].actions.find((a) => a.kind === 'stroke')
	if (!stroke || stroke.kind !== 'stroke') throw new Error('Sample stroke missing')
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
			props: documentStrokeProps(stroke, progress),
		})
		expect(shape).toMatchObject({ typeName: 'shape', type: 'draw' })
	}
})

it('maps a selected document to timed native actions and resets only its owned shapes', () => {
	const editor = {
		run: vi.fn().mockImplementation((fn: () => void) => fn()),
		getShape: vi.fn(),
		createShape: vi.fn(),
		updateShape: vi.fn(),
		deleteShapes: vi.fn(),
	}
	const doc = parsePresentation({
		version: 1,
		title: 'Custom',
		canvas: { width: 300, height: 200 },
		beats: [
			{
				id: 'custom',
				title: 'One cue',
				note: '',
				actions: [
					{ kind: 'text', text: 'Custom label', x: 20, y: 30, start: 100, duration: 1 },
					{
						kind: 'stroke',
						color: 'red',
						start: 200,
						duration: 400,
						points: [
							{ x: 10, y: 10, pressure: 0.2 },
							{ x: 100, y: 100, pressure: 0.9 },
						],
					},
				],
			},
		],
	})
	const scene = createPreparedScene(editor, doc)
	expect(scene.durations).toEqual([600])
	scene.begin(0)
	scene.render(0, 99)
	expect(editor.createShape).not.toHaveBeenCalled()
	scene.render(0, 100)
	expect(editor.createShape).toHaveBeenCalledWith(
		expect.objectContaining({ type: 'text', x: 20, y: 30 })
	)
	editor.getShape.mockReturnValue({ type: 'text' })
	scene.render(0, 400)
	expect(editor.updateShape).toHaveBeenCalledWith(
		expect.objectContaining({
			type: 'draw',
			props: expect.objectContaining({ color: 'red', isPen: true, isComplete: false }),
		})
	)
	scene.render(0, 600)
	expect(editor.updateShape).toHaveBeenLastCalledWith(
		expect.objectContaining({ props: expect.objectContaining({ isComplete: true }) })
	)
	scene.reset()
	expect(editor.deleteShapes).toHaveBeenCalledWith([
		createShapeId('presenter-0-0'),
		createShapeId('presenter-0-1'),
	])
	editor.getShape.mockReturnValue(undefined)
	editor.createShape.mockClear()
	scene.render(0, 600)
	expect(editor.createShape).toHaveBeenCalledTimes(2)
})

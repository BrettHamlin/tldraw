import { T, structuredClone } from 'tldraw'

const bounded = (min: number, max: number) =>
	T.number.check((n) => {
		if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Expected ${min}–${max}`)
	})
const title = T.string.check((s) => {
	if (!s.trim() || s.length > 200) throw new Error('Title must contain 1–200 characters')
})
const timing = { start: bounded(0, 600000), duration: bounded(1, 600000) }
export const actionSchema = T.union('kind', {
	stroke: T.object({
		kind: T.literal('stroke'),
		...timing,
		color: T.literalEnum('black', 'blue', 'green', 'red'),
		points: T.arrayOf(
			T.object({ x: bounded(0, 4096), y: bounded(0, 4096), pressure: bounded(0, 1) })
		).check((p) => {
			if (!p.length || p.length > 50000) throw new Error('Stroke needs 1–50000 points')
		}),
	}),
	text: T.object({
		kind: T.literal('text'),
		...timing,
		text: T.string,
		x: bounded(0, 4096),
		y: bounded(0, 4096),
	}),
})
export const presentationSchema = T.object({
	version: T.literal(1),
	title,
	canvas: T.object({ width: bounded(100, 4096), height: bounded(100, 4096) }),
	beats: T.arrayOf(
		T.object({ id: title, title, note: T.string, actions: T.arrayOf(actionSchema) })
	),
})
export type PresentationDocument = T.TypeOf<typeof presentationSchema>
export type PresentationAction = T.TypeOf<typeof actionSchema>
export type PresentationBeat = PresentationDocument['beats'][number]

export function parsePresentation(value: unknown): PresentationDocument {
	const doc = presentationSchema.validate(value)
	if (!doc.beats.length || doc.beats.length > 100) throw new Error('Presentation needs 1–100 beats')
	if (new Set(doc.beats.map((b) => b.id)).size !== doc.beats.length)
		throw new Error('Beat IDs must be unique')
	let points = 0
	for (const beat of doc.beats) {
		if (beat.actions.length > 500) throw new Error('A beat can contain at most 500 actions')
		for (const action of beat.actions) {
			const positions = action.kind === 'stroke' ? action.points : [action]
			points += positions.length
			if (positions.some((p) => p.x > doc.canvas.width || p.y > doc.canvas.height))
				throw new Error('Action extends outside the canvas')
		}
	}
	if (points > 200000) throw new Error('Presentation exceeds 200000 points')
	return structuredClone(doc)
}
export function beatDuration(beat: PresentationBeat) {
	return Math.max(1, ...beat.actions.map((a) => a.start + a.duration))
}
export function importPresentation(json: string, current: PresentationDocument) {
	try {
		return { document: parsePresentation(JSON.parse(json)), error: '' }
	} catch (error) {
		return {
			document: current,
			error: error instanceof Error ? error.message : 'Invalid presentation',
		}
	}
}

const librarySchema = T.object({
	version: T.literal(1),
	current: presentationSchema,
	saved: T.arrayOf(T.object({ id: T.string, document: presentationSchema })),
})
export type PresentationLibrary = T.TypeOf<typeof librarySchema>
export const libraryKey = 'presenter-canvas-library-v1'
export function restoreLibrary(json: string): PresentationLibrary {
	const library = librarySchema.validate(JSON.parse(json))
	return {
		version: 1,
		current: parsePresentation(library.current),
		saved: library.saved.map((s) => ({ id: s.id, document: parsePresentation(s.document) })),
	}
}
export function savePresentation(library: PresentationLibrary, id: string): PresentationLibrary {
	const document = parsePresentation(library.current)
	return { ...library, saved: [...library.saved.filter((s) => s.id !== id), { id, document }] }
}

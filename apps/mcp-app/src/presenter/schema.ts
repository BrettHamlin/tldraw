import { z } from 'zod'

const coordinate = z.number().min(0).max(4096)
const title = z
	.string()
	.min(1)
	.max(200)
	.refine((s) => !!s.trim(), 'Expected a nonblank title')
const timing = { start: z.number().min(0).max(600000), duration: z.number().min(1).max(600000) }
const point = z.strictObject({ x: coordinate, y: coordinate, pressure: z.number().min(0).max(1) })
const action = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('stroke'),
		...timing,
		color: z.enum(['black', 'blue', 'green', 'red']),
		points: z.array(point).min(1).max(50000),
	}),
	z.strictObject({
		kind: z.literal('text'),
		...timing,
		text: z.string(),
		x: coordinate,
		y: coordinate,
	}),
])

// This data boundary mirrors the independently shareable example's document.ts; neither app imports the other.
export const presentationSchema = z
	.strictObject({
		version: z.literal(1),
		title,
		canvas: z.strictObject({
			width: z.number().min(100).max(4096),
			height: z.number().min(100).max(4096),
		}),
		beats: z
			.array(
				z.strictObject({ id: title, title, note: z.string(), actions: z.array(action).max(500) })
			)
			.min(1)
			.max(100),
	})
	.superRefine((doc, ctx) => {
		if (new Set(doc.beats.map((b) => b.id)).size !== doc.beats.length)
			ctx.addIssue({ code: 'custom', message: 'Beat IDs must be unique' })
		let points = 0
		for (const beat of doc.beats)
			for (const action of beat.actions) {
				const positions = action.kind === 'stroke' ? action.points : [action]
				points += positions.length
				if (positions.some((p) => p.x > doc.canvas.width || p.y > doc.canvas.height))
					ctx.addIssue({ code: 'custom', message: 'Action extends outside the canvas' })
			}
		if (points > 200000)
			ctx.addIssue({ code: 'custom', message: 'Presentation exceeds 200000 points' })
	})
export type PresentationDocument = z.infer<typeof presentationSchema>
export const revisionSchema = z.number().int().min(0)
const acknowledgement = z.strictObject({
	sourceId: z.uuid(),
	revision: revisionSchema,
	browserId: z.string().min(1).max(100),
	state: z.enum(['received', 'applied', 'error']),
	message: z.string().max(1000).optional(),
})

export const acknowledgementSchema = z.union([
	acknowledgement.extend({ rehearsalSourceId: z.null(), rehearsalRevision: z.null() }),
	acknowledgement.extend({ rehearsalSourceId: z.uuid(), rehearsalRevision: revisionSchema }),
])

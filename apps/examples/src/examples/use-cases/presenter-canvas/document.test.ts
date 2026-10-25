import { importPresentation, parsePresentation, restoreLibrary, savePresentation } from './document'
import { sampleDocument } from './prepared'

it.each([
	'{',
	'{}',
	JSON.stringify({ ...sampleDocument, version: 2 }),
	JSON.stringify({ ...sampleDocument, beats: [] }),
])('keeps the current document and reports invalid import %s', (json) => {
	const result = importPresentation(json, sampleDocument)
	expect(result.document).toBe(sampleDocument)
	expect(result.error).not.toBe('')
})
it('rejects bad pressure, duplicate beat IDs, nonfinite timing, and out-of-canvas points', () => {
	const action = {
		kind: 'stroke',
		start: 0,
		duration: 1000,
		color: 'black',
		points: [{ x: 10, y: 10, pressure: 0.5 }],
	}
	const beat = { id: 'a', title: 'A', note: '', actions: [action] }
	const doc = { ...sampleDocument, beats: [beat] }
	expect(() => parsePresentation({ ...doc, beats: [beat, beat] })).toThrow('unique')
	for (const invalid of [
		{ ...action, duration: NaN },
		{ ...action, points: [{ x: 10, y: 10, pressure: 2 }] },
		{ ...action, points: [{ x: 1000, y: 10, pressure: 0.5 }] },
	]) {
		expect(() => parsePresentation({ ...doc, beats: [{ ...beat, actions: [invalid] }] })).toThrow()
	}
})
it('saves detached named documents, restores the selected draft, and updates an existing save', () => {
	const library = savePresentation({ version: 1, current: sampleDocument, saved: [] }, 'sample')
	const custom = parsePresentation({
		...sampleDocument,
		title: 'My presentation',
		beats: [sampleDocument.beats[2]],
	})
	const saved = savePresentation({ ...library, current: custom }, 'custom')
	const restored = restoreLibrary(JSON.stringify(saved))
	expect(restored).toEqual(saved)
	expect(restored.saved.map((s) => s.document.title)).toEqual([
		sampleDocument.title,
		'My presentation',
	])
	custom.beats[0].title = 'Later draft edit'
	expect(restored.saved[1].document.beats[0].title).not.toBe('Later draft edit')
	const updated = savePresentation(
		{ ...restored, current: { ...restored.current, title: 'Revised' } },
		'custom'
	)
	expect(updated.saved).toHaveLength(2)
	expect(updated.saved[1].document.title).toBe('Revised')
})
it('imports a reusable document without retaining references to the input', () => {
	const input = { ...sampleDocument, title: 'Imported' }
	const result = importPresentation(JSON.stringify(input), sampleDocument)
	expect(result.error).toBe('')
	expect(result.document.title).toBe('Imported')
	expect(result.document).not.toBe(input)
	expect(result.document.beats).not.toBe(sampleDocument.beats)
})

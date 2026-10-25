import { structuredClone } from 'tldraw'
import { parsePresentation, type PresentationDocument } from './document'

interface AuthoringHost {
	getDocument(): PresentationDocument
	replaceDocument(document: PresentationDocument): void
}

const example: PresentationDocument = {
	version: 1,
	title: 'A request reaches a server',
	canvas: { width: 900, height: 680 },
	beats: [
		{
			id: 'request',
			title: 'Send the request',
			note: 'Explain what the browser needs, then advance.',
			actions: [
				{ kind: 'text', start: 0, duration: 1, text: 'Browser', x: 100, y: 100 },
				{
					kind: 'stroke',
					start: 200,
					duration: 1000,
					color: 'blue',
					points: [
						{ x: 100, y: 160, pressure: 0.2 },
						{ x: 200, y: 160, pressure: 0.8 },
						{ x: 300, y: 160, pressure: 0.2 },
					],
				},
			],
		},
	],
}

export function createAiAuthoringBridge(host: AuthoringHost) {
	return {
		describe() {
			return {
				name: 'tldraw presenter authoring',
				transport: 'Existing T3 MCP preview_evaluate on the presenter page',
				usage:
					'Read window.tldrawPresenter.getDocument(); submit data with window.tldrawPresenter.replaceDocument(document).',
				rules: [
					'Coordinates are canvas pixels; start and duration are milliseconds within each beat.',
					'Each beat holds for the presenter. Use distinct beats for explanatory pauses.',
					'Stroke points are ordered {x, y, pressure}; pressure is between 0 and 1.',
					'Use enough sampled points for progressive drawing, not only two distant endpoints.',
					'Colors: black, blue, green, red. Text actions use kind, start, duration, text, x, y.',
					'Keep coordinates within the canvas and leave margins for text; beat IDs must be unique.',
					'Submissions replace the editable draft. Starting a new rehearsal is a separate presenter action.',
				],
				example: structuredClone(example),
			}
		},
		getDocument() {
			return structuredClone(host.getDocument())
		},
		replaceDocument(input: unknown) {
			const document = parsePresentation(input)
			host.replaceDocument(document)
			return {
				title: document.title,
				beats: document.beats.length,
				actions: document.beats.reduce((total, beat) => total + beat.actions.length, 0),
			}
		},
	}
}

declare global {
	interface Window {
		tldrawPresenter?: ReturnType<typeof createAiAuthoringBridge>
	}
}

export function installAiAuthoringBridge(host: AuthoringHost) {
	const bridge = createAiAuthoringBridge(host)
	window.tldrawPresenter = bridge
	return () => {
		if (window.tldrawPresenter === bridge) delete window.tldrawPresenter
	}
}

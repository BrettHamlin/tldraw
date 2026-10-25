import { McpDraftReceiver } from './ai-mcp-client'
import { parsePresentation } from './document'

const document = () =>
	parsePresentation({
		version: 1,
		title: 'A drawing',
		canvas: { width: 900, height: 680 },
		beats: [{ id: 'one', title: 'One', note: '', actions: [] }],
	})
function browser(consumed: string | null = null) {
	let draft = document()
	let rehearsalId: string | null = null
	const replace = vi.fn((next: typeof draft) => {
		draft = next
	})
	const receiver = new McpDraftReceiver(
		{ getDocument: () => draft, replaceDocument: replace, getRehearsalId: () => rehearsalId },
		consumed
	)
	return {
		receiver,
		replace,
		edit: () => {
			draft.title = 'Local edit'
		},
		draft: () => draft,
		acknowledgeRehearsal: (id: string) => {
			rehearsalId = id
		},
	}
}

it('accepts one new remote draft without identifying any active rehearsal', () => {
	const { receiver, replace, draft } = browser()
	expect(
		receiver.receive({ sourceId: 'server-one', revision: 1, document: document() })
	).toMatchObject({
		state: 'applied',
		consumed: 'server-one:1',
		rehearsalSourceId: null,
		rehearsalRevision: null,
	})
	expect(replace).toHaveBeenCalledOnce()
	expect(draft().title).toBe('A drawing')
})

it('does not replay a consumed revision over local edits or after reload', () => {
	const { receiver, edit, draft, replace } = browser('server-one:1')
	edit()
	expect(
		receiver.receive({ sourceId: 'server-one', revision: 1, document: document() }).state
	).toBe('received')
	expect(replace).not.toHaveBeenCalled()
	expect(draft().title).toBe('Local edit')
})

it('accepts a new source after service restart and then a newer revision', () => {
	const { receiver, replace } = browser('server-one:1')
	receiver.receive({ sourceId: 'server-two', revision: 1, document: document() })
	receiver.receive({ sourceId: 'server-two', revision: 1, document: document() })
	receiver.receive({ sourceId: 'server-two', revision: 2, document: document() })
	expect(replace).toHaveBeenCalledTimes(2)
})

it('rejects invalid data without consuming the revision or changing the draft', () => {
	const { receiver, replace, draft } = browser()
	const before = draft()
	expect(
		receiver.receive({
			sourceId: 'server-one',
			revision: 1,
			document: { ...document(), beats: [] },
		})
	).toMatchObject({
		state: 'error',
		envelope: { sourceId: 'server-one', revision: 1 },
		consumed: null,
		message: expect.any(String),
	})
	expect(replace).not.toHaveBeenCalled()
	expect(draft()).toEqual(before)
	expect(
		receiver.receive({ sourceId: 'server-one', revision: 1, document: document() }).state
	).toBe('applied')
})

it('retains the active rehearsal provenance while newer drafts and server instances arrive', () => {
	const { receiver, acknowledgeRehearsal } = browser()
	receiver.receive({ sourceId: 'server-one', revision: 1, document: document() })
	receiver.markRehearsal('show-one', document())
	expect(receiver.getRehearsalProvenance()).toEqual({
		rehearsalSourceId: null,
		rehearsalRevision: null,
	})
	acknowledgeRehearsal('show-one')
	expect(receiver.getRehearsalProvenance()).toEqual({
		rehearsalSourceId: 'server-one',
		rehearsalRevision: 1,
	})
	const newer = document()
	newer.title = 'Another drawing'
	expect(receiver.receive({ sourceId: 'server-one', revision: 2, document: newer })).toMatchObject({
		rehearsalSourceId: 'server-one',
		rehearsalRevision: 1,
	})
	expect(
		receiver.receive({ sourceId: 'server-two', revision: 1, document: document() })
	).toMatchObject({ rehearsalSourceId: 'server-one', rehearsalRevision: 1 })
	receiver.markRehearsal('show-two', document())
	acknowledgeRehearsal('show-two')
	expect(receiver.getRehearsalProvenance()).toEqual({
		rehearsalSourceId: 'server-two',
		rehearsalRevision: 1,
	})
})

it('leaves manually authored rehearsals unattributed to the remote draft', () => {
	const { receiver, acknowledgeRehearsal } = browser()
	receiver.receive({ sourceId: 'server-one', revision: 1, document: document() })
	const manual = document()
	manual.title = 'Manual'
	receiver.markRehearsal('manual-show', manual)
	acknowledgeRehearsal('manual-show')
	expect(receiver.getRehearsalProvenance()).toEqual({
		rehearsalSourceId: null,
		rehearsalRevision: null,
	})
})

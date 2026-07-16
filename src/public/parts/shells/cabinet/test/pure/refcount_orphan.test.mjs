import { normalizeEntry, listChildren, patchEntry } from '../../src/entryModel.mjs'

Deno.test('orphaned entries hidden from listChildren by default', () => {
	const entity = 'a'.repeat(64)
	const file = normalizeEntry({ id: 'f1', name: 'x', kind: 'file', orphaned: true }, entity)
	const link = normalizeEntry({
		id: 'l1',
		name: 'link',
		kind: 'link',
		link: { owner_entity_hash: entity, cabinet_id: 'c1', entry_id: 'f1' },
	}, entity)
	if (!file.orphaned) throw new Error('orphaned flag missing')
	const visible = listChildren([file, link], null)
	if (visible.some(row => row.id === 'f1')) throw new Error('orphaned shown')
	if (!visible.some(row => row.id === 'l1')) throw new Error('link missing')
	const all = listChildren([file, link], null, { show_orphaned: true })
	if (!all.some(row => row.id === 'f1')) throw new Error('show_orphaned failed')
	const patched = patchEntry(file, { orphaned: false }, entity)
	if (patched.orphaned) throw new Error('patch orphaned failed')
})

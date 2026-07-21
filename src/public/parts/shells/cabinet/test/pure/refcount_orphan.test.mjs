/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

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
	assertEquals(file.orphaned, true)
	const visible = listChildren([file, link], null)
	assertEquals(visible.some(row => row.id === 'f1'), false)
	assertEquals(visible.some(row => row.id === 'l1'), true)
	const all = listChildren([file, link], null, { show_orphaned: true })
	assertEquals(all.some(row => row.id === 'f1'), true)
	const patched = patchEntry(file, { orphaned: false }, entity)
	assertEquals(patched.orphaned, false)
})

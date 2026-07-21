/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	buildFolderTrail,
	collectSubtreeIds,
	listChildren,
	normalizeEntry,
	patchEntry,
} from '../../src/entryModel.mjs'

Deno.test('normalizeEntry defaults and snake_case fields', () => {
	const entry = normalizeEntry({ name: 'a.txt', kind: 'file', mime_type: 'text/plain' }, 'abcd')
	assertEquals(entry.name, 'a.txt')
	assertEquals(entry.mime_type, 'text/plain')
	assertEquals(entry.parent_id, null)
	assertEquals(entry.attrs.hidden, false)
	assertEquals(entry.created.entity_hash, 'abcd')
	assertEquals(entry.preview.delete_with_file, true)
})

Deno.test('listChildren filters hidden and sorts folders first', () => {
	const entries = [
		normalizeEntry({ id: 'f1', name: 'z', kind: 'file', parent_id: null }, 'e'),
		normalizeEntry({ id: 'd1', name: 'a', kind: 'folder', parent_id: null }, 'e'),
		normalizeEntry({ id: 'h1', name: 'hidden', kind: 'file', parent_id: null, attrs: { hidden: true } }, 'e'),
		normalizeEntry({ id: 'c1', name: 'child', kind: 'file', parent_id: 'd1' }, 'e'),
	]
	const root = listChildren(entries, null)
	assertEquals(root.map(row => row.id), ['d1', 'f1'])
	const withHidden = listChildren(entries, null, { show_hidden: true })
	assertEquals(withHidden.length, 3)
	assertEquals(listChildren(entries, 'd1').map(row => row.id), ['c1'])
})

Deno.test('buildFolderTrail returns named root-to-folder path', () => {
	const entries = [
		normalizeEntry({ id: 'docs', name: '文档', kind: 'folder' }, 'e'),
		normalizeEntry({ id: 'notes', name: '笔记', kind: 'folder', parent_id: 'docs' }, 'e'),
	]
	assertEquals(buildFolderTrail(entries, 'notes'), [
		{ id: 'docs', name: '文档' },
		{ id: 'notes', name: '笔记' },
	])
	assertEquals(buildFolderTrail(entries, null), [])
})

Deno.test('collectSubtreeIds includes descendants', () => {
	const entries = [
		normalizeEntry({ id: 'root', name: 'root', kind: 'folder' }, 'e'),
		normalizeEntry({ id: 'a', name: 'a', kind: 'folder', parent_id: 'root' }, 'e'),
		normalizeEntry({ id: 'b', name: 'b', kind: 'file', parent_id: 'a' }, 'e'),
	]
	const ids = collectSubtreeIds(entries, 'root')
	assertEquals([...ids].sort(), ['a', 'b', 'root'])
})

Deno.test('patchEntry updates description and modified stamp', () => {
	const entry = normalizeEntry({ name: 'x', description: 'old' }, 'e1')
	const next = patchEntry(entry, { description: 'new' }, 'e2')
	assertEquals(next.description, 'new')
	assertEquals(next.modified.entity_hash, 'e2')
	assertEquals(next.created.entity_hash, 'e1')
})

Deno.test('link entry shape', () => {
	const entry = normalizeEntry({
		kind: 'link',
		name: 'to-default',
		link: { owner_entity_hash: 'AA', cabinet_id: 'default', entry_id: null },
	}, 'e')
	assertEquals(entry.kind, 'link')
	assertEquals(entry.link.cabinet_id, 'default')
	assertEquals(entry.link.entry_id, null)
	assertEquals(entry.link.owner_entity_hash, 'aa')
})

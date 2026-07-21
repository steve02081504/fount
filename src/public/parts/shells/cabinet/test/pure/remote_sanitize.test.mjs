/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { sanitizeRemoteCabinets, sanitizeRemoteIndex } from '../../src/remote.mjs'

Deno.test('sanitizeRemoteCabinets drops garbage', () => {
	const rows = sanitizeRemoteCabinets({
		cabinets: [
			{ cabinet_id: 'a', name: 'A', visibility: { visibility: 'public' } },
			{ name: 'no-id' },
			null,
		],
	})
	assertEquals(rows.length, 1)
	assertEquals(rows[0].cabinet_id, 'a')
	assertEquals(rows[0].type, 'personal')
})

Deno.test('sanitizeRemoteIndex caps and normalizes', () => {
	const index = sanitizeRemoteIndex({
		entries: [
			{ id: '1', name: 'x', kind: 'weird', attrs: { hidden: 1 } },
			{ id: '2', kind: 'folder', name: 'd' },
		],
	})
	assertEquals(index.entries[0].kind, 'file')
	assertEquals(index.entries[0].attrs.hidden, true)
	assertEquals(index.entries[1].kind, 'folder')
})

Deno.test('sanitizeRemoteIndex drops unsafe preview urls', () => {
	const index = sanitizeRemoteIndex({
		entries: [
			{ id: '1', name: 'a', preview: { url: 'https://cdn.example/t.jpg' } },
			{ id: '2', name: 'b', preview: { url: '//evil.example/t.gif' } },
			{ id: '3', name: 'c', preview: { url: 'javascript:alert(1)' } },
		],
	})
	assertEquals(index.entries[0].preview.url, 'https://cdn.example/t.jpg')
	assertEquals(index.entries[1].preview.url, '')
	assertEquals(index.entries[2].preview.url, '')
})

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

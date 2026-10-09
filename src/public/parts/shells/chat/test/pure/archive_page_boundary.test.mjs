/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { archiveMonthCanAffectPage } from '../../src/chat/archive/pageBoundary.mjs'

const lines = ['2026-07-31T23:59:59Z', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z'].map((date, index) => ({ eventId: `id-${index}`, hlc: { wall: Date.parse(date) } }))

Deno.test('archive page stops before strictly older months once the page is complete', () => {
	assertEquals(archiveMonthCanAffectPage(lines, '2026-07', { limit: 2 }), false)
	assertEquals(archiveMonthCanAffectPage(lines, '2026-08', { limit: 2 }), true)
	assertEquals(archiveMonthCanAffectPage(lines, '2026-07', { before: 'id-2', limit: 2 }), true)
})

Deno.test('archive page reads through missing cursors, short pages and explicit event lookups', () => {
	assertEquals(archiveMonthCanAffectPage(lines, '2026-01', { before: 'missing', limit: 2 }), true)
	assertEquals(archiveMonthCanAffectPage(lines, '2026-01', { limit: 4 }), true)
	assertEquals(archiveMonthCanAffectPage(lines, '2026-01', { limit: 2, eventIds: ['old-message'] }), true)
	assertEquals(archiveMonthCanAffectPage([{ eventId: 'unknown-time' }], '2026-01', { limit: 1 }), true)
})

/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { parseDurationMs, pastDeadline } from '../duration.mjs'

Deno.test('parseDurationMs', () => {
	assertEquals(parseDurationMs('5m'), 300_000)
	assertEquals(parseDurationMs('90s'), 90_000)
	assertEquals(parseDurationMs('500ms'), 500)
	assertEquals(parseDurationMs('2h'), 7_200_000)
	assertEquals(parseDurationMs('300'), 300_000)
	assertEquals(parseDurationMs(undefined), null)
	assertEquals(parseDurationMs('nope'), null)
})

Deno.test('pastDeadline', () => {
	assertEquals(pastDeadline(1000, 999), false)
	assertEquals(pastDeadline(1000, 1000), true)
	assertEquals(pastDeadline(null, 9999), false)
})

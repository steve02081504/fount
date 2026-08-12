/**
 * `fount log` 选择器解析与过滤。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	parseLogSelector,
	selectLogEntries,
} from '../selector.mjs'

Deno.test('parseLogSelector: error:5', () => {
	assertEquals(parseLogSelector('error:5'), { levels: ['error'], count: 5 })
})

Deno.test('parseLogSelector: bare count and :count', () => {
	assertEquals(parseLogSelector('5'), { levels: null, count: 5 })
	assertEquals(parseLogSelector(':5'), { levels: null, count: 5 })
})

Deno.test('parseLogSelector: level only / multi-level', () => {
	assertEquals(parseLogSelector('error'), { levels: ['error'], count: null })
	assertEquals(parseLogSelector('error+warn:10'), { levels: ['error', 'warn'], count: 10 })
	assertEquals(parseLogSelector('err+warning'), { levels: ['error', 'warn'], count: null })
})

Deno.test('parseLogSelector: rejects garbage', () => {
	assertThrows(() => parseLogSelector(''))
	assertThrows(() => parseLogSelector('nope:3'))
	assertThrows(() => parseLogSelector('error:0'))
	assertThrows(() => parseLogSelector('error:-1'))
	assertThrows(() => parseLogSelector('error:x'))
	assertThrows(() => parseLogSelector(':'))
})

Deno.test('selectLogEntries: last N of level', () => {
	const entries = [
		{ level: 'info', id: 1 },
		{ level: 'error', id: 2 },
		{ level: 'error', id: 3 },
		{ level: 'warn', id: 4 },
		{ level: 'error', id: 5 },
		{ level: 'error', id: 6 },
	]
	assertEquals(
		selectLogEntries(entries, parseLogSelector('error:3')).map(e => e.id),
		[3, 5, 6],
	)
	assertEquals(
		selectLogEntries(entries, parseLogSelector('error+warn:2')).map(e => e.id),
		[5, 6],
	)
	assertEquals(
		selectLogEntries(entries, parseLogSelector(':2')).map(e => e.id),
		[5, 6],
	)
	assertEquals(
		selectLogEntries(entries, parseLogSelector('warn')).map(e => e.id),
		[4],
	)
})

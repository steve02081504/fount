/**
 * skip_because 解析与开/关/延缓语义。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	isSkipBecauseBlocking,
	parseSkipBecause,
	skipBecauseAction,
	skipBecauseEntriesForRun,
	skipBecauseSuiteKeys,
	skipBecauseUrlsForRun,
} from '../core/skip_because.mjs'

const URL_A = 'https://github.com/denoland/deno/issues/35804'
const URL_B = 'https://github.com/denoland/deno/issues/36168'

Deno.test('parseSkipBecause accepts URL string or array', () => {
	assertEquals(parseSkipBecause([URL_A, URL_B], 'suite "x"'), [
		{ url: URL_A, delayMs: 0 },
		{ url: URL_B, delayMs: 0 },
	])
	assertEquals(parseSkipBecause(URL_A, 'suite "x"'), [{ url: URL_A, delayMs: 0 }])
	assertEquals(parseSkipBecause([URL_A, URL_A], 'suite "x"'), [{ url: URL_A, delayMs: 0 }])
	assertEquals(parseSkipBecause(undefined, 'suite "x"'), undefined)
	assertEquals(parseSkipBecause('', 'suite "x"'), undefined)
	assertEquals(parseSkipBecause([], 'suite "x"'), undefined)
})

Deno.test('parseSkipBecause accepts {url, delay} object or array', () => {
	assertEquals(parseSkipBecause({ url: URL_A, delay: '14d' }, 'suite "x"'), [
		{ url: URL_A, delayMs: 14 * 24 * 60 * 60 * 1000 },
	])
	assertEquals(parseSkipBecause({ url: URL_A }, 'suite "x"'), [{ url: URL_A, delayMs: 0 }])
	assertEquals(parseSkipBecause({ url: URL_A, delay: 5000 }, 'suite "x"'), [{ url: URL_A, delayMs: 5000 }])
	assertEquals(parseSkipBecause({ url: URL_A, delay: 0 }, 'suite "x"'), [{ url: URL_A, delayMs: 0 }])
	assertEquals(parseSkipBecause([
		URL_A,
		{ url: URL_B, delay: '2h' },
	], 'suite "x"'), [
		{ url: URL_A, delayMs: 0 },
		{ url: URL_B, delayMs: 2 * 60 * 60 * 1000 },
	])
	assertEquals(parseSkipBecause([
		{ url: URL_A, delay: '1d' },
		{ url: URL_A, delay: '3d' },
	], 'suite "x"'), [{ url: URL_A, delayMs: 3 * 24 * 60 * 60 * 1000 }])
})

Deno.test('parseSkipBecause rejects non-URL values', () => {
	assertThrows(() => parseSkipBecause(['https://github.com/denoland/deno/pull/1'], 'suite "x"'))
	assertThrows(() => parseSkipBecause(['not-a-url'], 'suite "x"'))
	assertThrows(() => parseSkipBecause({ delay: '7d' }, 'suite "x"'))
	assertThrows(() => parseSkipBecause({ url: URL_A, delay: 'nope' }, 'suite "x"'))
})

Deno.test('isSkipBecauseBlocking honors closedAt + delay', () => {
	assertEquals(isSkipBecauseBlocking({ closed: false, closedAt: null }, 5000, 99999), false)
	assertEquals(isSkipBecauseBlocking({ closed: true, closedAt: 1000 }, 0, 1000), true)
	assertEquals(isSkipBecauseBlocking({ closed: true, closedAt: 1000 }, 5000, 2000), false)
	assertEquals(isSkipBecauseBlocking({ closed: true, closedAt: 1000 }, 5000, 6000), true)
	assertEquals(isSkipBecauseBlocking({ closed: true, closedAt: null }, 5000, 0), true)
})

Deno.test('skipBecauseAction fails if any URL is blocking', () => {
	assertEquals(skipBecauseAction([]), 'pass')
	assertEquals(skipBecauseAction([URL_A]), 'fail')
	assertEquals(skipBecauseAction([URL_A, URL_B]), 'fail')
})

Deno.test('skipBecauseUrlsForRun unions subtest URLs when all targeted are marked', () => {
	const suite = {
		skipBecause: undefined,
		subtests: [
			{ name: 'a', skipBecause: [{ url: URL_A, delayMs: 0 }] },
			{ name: 'b', skipBecause: [{ url: URL_B, delayMs: 1000 }] },
			{ name: 'c' },
		],
	}
	assertEquals(skipBecauseUrlsForRun(suite), undefined)
	assertEquals(skipBecauseUrlsForRun(suite, ['a', 'b']), [URL_A, URL_B])
	assertEquals(skipBecauseEntriesForRun(suite, ['a', 'b']), [
		{ url: URL_A, delayMs: 0 },
		{ url: URL_B, delayMs: 1000 },
	])
	assertEquals(skipBecauseUrlsForRun({ skipBecause: [{ url: URL_A, delayMs: 0 }], subtests: suite.subtests }, ['c']), [URL_A])
	assertEquals(skipBecauseSuiteKeys([
		{ manifestId: 'm', name: 's', skipBecause: [{ url: URL_A, delayMs: 0 }] },
		{ manifestId: 'm', name: 'other' },
	]), ['m:s'])
})

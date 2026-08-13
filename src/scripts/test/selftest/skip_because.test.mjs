/**
 * skip_because 解析与开/关语义。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	parseSkipBecause,
	skipBecauseAction,
	skipBecauseSuiteKeys,
	skipBecauseUrlsForRun,
} from '../core/skip_because.mjs'

const URL_A = 'https://github.com/denoland/deno/issues/35804'
const URL_B = 'https://github.com/denoland/deno/issues/36168'

Deno.test('parseSkipBecause accepts URL array', () => {
	assertEquals(parseSkipBecause([URL_A, URL_B], 'suite "x"'), [URL_A, URL_B])
	assertEquals(parseSkipBecause([URL_A, URL_A], 'suite "x"'), [URL_A])
	assertEquals(parseSkipBecause(undefined, 'suite "x"'), undefined)
	assertEquals(parseSkipBecause('', 'suite "x"'), undefined)
	assertEquals(parseSkipBecause([], 'suite "x"'), undefined)
})

Deno.test('parseSkipBecause rejects non-array and non-issue URL', () => {
	assertThrows(() => parseSkipBecause(URL_A, 'suite "x"'))
	assertThrows(() => parseSkipBecause(['https://github.com/denoland/deno/pull/1'], 'suite "x"'))
	assertThrows(() => parseSkipBecause(['not-a-url'], 'suite "x"'))
})

Deno.test('skipBecauseAction fails if any URL is closed', () => {
	assertEquals(skipBecauseAction([]), 'pass')
	assertEquals(skipBecauseAction([URL_A]), 'fail')
	assertEquals(skipBecauseAction([URL_A, URL_B]), 'fail')
})

Deno.test('skipBecauseUrlsForRun unions subtest URLs when all targeted are marked', () => {
	const suite = {
		skipBecause: undefined,
		subtests: [
			{ name: 'a', skipBecause: [URL_A] },
			{ name: 'b', skipBecause: [URL_B] },
			{ name: 'c' },
		],
	}
	assertEquals(skipBecauseUrlsForRun(suite), undefined)
	assertEquals(skipBecauseUrlsForRun(suite, ['a', 'b']), [URL_A, URL_B])
	assertEquals(skipBecauseUrlsForRun({ skipBecause: [URL_A], subtests: suite.subtests }, ['c']), [URL_A])
	assertEquals(skipBecauseSuiteKeys([
		{ manifestId: 'm', name: 's', skipBecause: [URL_A] },
		{ manifestId: 'm', name: 'other' },
	]), ['m:s'])
})

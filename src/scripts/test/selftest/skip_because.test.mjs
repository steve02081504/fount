/**
 * skip_because 解析与开/关/延缓语义。
 */
/* global Deno */
import { assertEquals, assertThrows } from 'jsr:@std/assert'

import {
	isPassSkipBlock,
	isSkipBecauseBlocking,
	isSkipBecausePass,
	isSkipBecauseSkipTree,
	parseSkipBecause,
	skipBecauseAction,
	skipBecauseAs,
	skipBecauseEntriesForRun,
	skipBecauseSuiteKeys,
	skipBecauseUrlsForRun,
	skipTreeDescendantKeys,
} from '../core/skip_because.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'

const URL_A = 'https://github.com/denoland/deno/issues/35804'
const URL_B = 'https://github.com/denoland/deno/issues/36168'

/**
 * @param {string} url issue URL
 * @param {number} [delayMs] delay
 * @param {'pass' | 'skip_tree'} [as] as
 * @returns {{ url: string, delayMs: number, as: 'pass' | 'skip_tree' }} 条目
 */
function entry(url, delayMs = 0, as = 'pass') {
	return { url, delayMs, as }
}

Deno.test('parseSkipBecause accepts URL string or array', () => {
	assertEquals(parseSkipBecause([URL_A, URL_B], 'suite "x"'), [entry(URL_A), entry(URL_B)])
	assertEquals(parseSkipBecause(URL_A, 'suite "x"'), [entry(URL_A)])
	assertEquals(parseSkipBecause([URL_A, URL_A], 'suite "x"'), [entry(URL_A)])
	assertEquals(parseSkipBecause(undefined, 'suite "x"'), undefined)
	assertEquals(parseSkipBecause('', 'suite "x"'), undefined)
	assertEquals(parseSkipBecause([], 'suite "x"'), undefined)
})

Deno.test('parseSkipBecause accepts {url, delay} object or array', () => {
	assertEquals(parseSkipBecause({ url: URL_A, delay: '14d' }, 'suite "x"'), [
		entry(URL_A, 14 * 24 * 60 * 60 * 1000),
	])
	assertEquals(parseSkipBecause({ url: URL_A }, 'suite "x"'), [entry(URL_A)])
	assertEquals(parseSkipBecause({ url: URL_A, delay: 5000 }, 'suite "x"'), [entry(URL_A, 5000)])
	assertEquals(parseSkipBecause({ url: URL_A, delay: 0 }, 'suite "x"'), [entry(URL_A)])
	assertEquals(parseSkipBecause([
		URL_A,
		{ url: URL_B, delay: '2h' },
	], 'suite "x"'), [
		entry(URL_A),
		entry(URL_B, 2 * 60 * 60 * 1000),
	])
	assertEquals(parseSkipBecause([
		{ url: URL_A, delay: '1d' },
		{ url: URL_A, delay: '3d' },
	], 'suite "x"'), [entry(URL_A, 3 * 24 * 60 * 60 * 1000)])
})

Deno.test('parseSkipBecause as defaults to pass; skip_tree merges over pass', () => {
	assertEquals(parseSkipBecause({ url: URL_A, as: 'pass' }, 'suite "x"'), [entry(URL_A)])
	assertEquals(parseSkipBecause({ url: URL_A, as: 'skip_tree' }, 'suite "x"'), [entry(URL_A, 0, 'skip_tree')])
	assertEquals(parseSkipBecause([
		{ url: URL_A, as: 'pass' },
		{ url: URL_A, as: 'skip_tree', delay: '1d' },
	], 'suite "x"'), [entry(URL_A, 24 * 60 * 60 * 1000, 'skip_tree')])
	assertEquals(skipBecauseAs(parseSkipBecause([
		{ url: URL_A, as: 'pass' },
		{ url: URL_B, as: 'skip_tree' },
	], 'suite "x"')), 'skip_tree')
	assertThrows(() => parseSkipBecause({ url: URL_A, as: 'nope' }, 'suite "x"'))
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
			{ name: 'a', skipBecause: [entry(URL_A)] },
			{ name: 'b', skipBecause: [entry(URL_B, 1000)] },
			{ name: 'c' },
		],
	}
	assertEquals(skipBecauseUrlsForRun(suite), undefined)
	assertEquals(skipBecauseUrlsForRun(suite, ['a', 'b']), [URL_A, URL_B])
	assertEquals(skipBecauseEntriesForRun(suite, ['a', 'b']), [
		entry(URL_A),
		entry(URL_B, 1000),
	])
	assertEquals(skipBecauseUrlsForRun({ skipBecause: [entry(URL_A)], subtests: suite.subtests }, ['c']), [URL_A])
	assertEquals(skipBecauseSuiteKeys([
		{ manifestId: 'm', name: 's', skipBecause: [entry(URL_A)] },
		{ manifestId: 'm', name: 'other' },
	]), ['m:s'])
})

Deno.test('skip_tree descendants exclude the root; pass-skip block is obsolete', () => {
	const live = makeSuite('server', 'live', { skipBecause: [entry(URL_A, 0, 'skip_tree')] })
	const child = makeSuite('shells/chat', 'frontend', { dependsOn: ['server:live'] })
	const grand = makeSuite('shells/chat', 'ws', { dependsOn: ['frontend'] })
	const other = makeSuite('checks', 'i18n_keys')
	assertEquals(isSkipBecauseSkipTree(live), true)
	assertEquals(isSkipBecausePass(live), false)
	assertEquals([...skipTreeDescendantKeys([live, child, grand, other])].sort(), [
		'shells/chat:frontend',
		'shells/chat:ws',
	])
	const passLive = makeSuite('server', 'live', { skipBecause: [entry(URL_A)] })
	assertEquals(isSkipBecausePass(passLive), true)
	const byKey = new Map([['server:live', passLive]])
	assertEquals(isPassSkipBlock(makeStateEntry({ status: 'blocked', blockedBy: ['server:live'] }), byKey), true)
	assertEquals(isPassSkipBlock(makeStateEntry({ status: 'failed' }), byKey), false)
})

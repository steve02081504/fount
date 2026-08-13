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

import { startTestKernel } from '../kernel/server.mjs'

import { makeStateEntry, makeSuite } from './fixtures.mjs'
import {
	awaitJob,
	dummySkipSuite,
	enqueueAndAwaitSkip,
	enqueueDummyJob,
	issueClosed,
	issueStillOpen,
	SKIP_URL,
} from './kernel_fixtures.mjs'

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
	const blocked = makeStateEntry({ status: 'blocked', blockedBy: ['server:live'] })
	assertEquals(isPassSkipBlock(blocked, byKey, new Map([[URL_A, { closed: false, closedAt: null }]])), true)
	assertEquals(isPassSkipBlock(blocked, byKey, new Map([[URL_A, { closed: true, closedAt: 1000 }]])), false)
})

/** 与 kernel_lifecycle 错开端口。 */
const SKIP_KERNEL_PORT = 18920

Deno.test('skip_because open does not spawn and counts as pass', async () => {
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		handle.kernel.issueCache.getState = issueStillOpen
		const { end } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_probe_open__', SKIP_URL),
			'skip-open',
		)
		assertEquals(end?.passed, true)
		assertEquals(end?.skipBecause, [SKIP_URL])
		assertEquals(handle.kernel.running.size, 0)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because closed fails without spawn', async () => {
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT + 1,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		handle.kernel.issueCache.getState = issueClosed
		const { end, job } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_probe_closed__', SKIP_URL),
			'skip-closed',
		)
		assertEquals(end?.passed, false)
		assertEquals(end?.skipBecause, [SKIP_URL])
		assertEquals(end?.skipBecauseClosed, [SKIP_URL])
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because any closed URL fails and lists follow-up', async () => {
	const urlB = 'https://github.com/denoland/deno/issues/36168'
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT + 2,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		/**
		 * @param {string} url issue URL
		 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 仅第二号已关
		 */
		async function onlySecondClosed(url) {
			return url === urlB
				? { closed: true, closedAt: 0 }
				: { closed: false, closedAt: null }
		}
		handle.kernel.issueCache.getState = onlySecondClosed
		const { end, job } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_probe_mixed__', [SKIP_URL, urlB]),
			'skip-mixed',
		)
		assertEquals(end?.passed, false)
		assertEquals(end?.skipBecause, [SKIP_URL, urlB])
		assertEquals(end?.skipBecauseClosed, [urlB])
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because leftover failed does not block dependents without re-probe', async () => {
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT + 3,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const dep = dummySkipSuite('__skip_stale_dep__', SKIP_URL)
		const depKey = 'testkit:__skip_stale_dep__'
		const childKey = 'testkit:__skip_stale_child__'
		const child = {
			manifestId: 'testkit',
			name: '__skip_stale_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__skip_stale_dep__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(dep, child)
		handle.kernel.catalog.byKey.set(depKey, dep)
		handle.kernel.catalog.byKey.set(childKey, child)
		handle.kernel.state.suites[depKey] = {
			status: 'failed',
			durationMs: 0,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		}
		const { job, end } = enqueueDummyJob(handle.kernel, { key: childKey, jobId: 'skip-stale-child' })
		handle.kernel.wake()
		await awaitJob(job, 'child stayed queued on leftover skip fail')
		assertEquals(end()?.blockedBy ?? [], [])
		assertEquals(end()?.passed, true)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_tree leftover failed skips dependents without failing the job', async () => {
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT + 4,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const dep = dummySkipSuite('__skip_tree_dep__', { url: SKIP_URL, as: 'skip_tree' })
		const depKey = 'testkit:__skip_tree_dep__'
		const childKey = 'testkit:__skip_tree_child__'
		const child = {
			manifestId: 'testkit',
			name: '__skip_tree_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__skip_tree_dep__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(dep, child)
		handle.kernel.catalog.byKey.set(depKey, dep)
		handle.kernel.catalog.byKey.set(childKey, child)
		handle.kernel.state.suites[depKey] = {
			status: 'failed',
			durationMs: 0,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		}
		const { job, end } = enqueueDummyJob(handle.kernel, { key: childKey, jobId: 'skip-tree-child' })
		handle.kernel.wake()
		await awaitJob(job, 'child stayed queued on skip_tree leftover')
		assertEquals(end()?.skippedBy, [depKey])
		assertEquals(end()?.blockedBy ?? [], [])
		assertEquals(job.exitCode, 0)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because pass unblocks dependents despite stale failed state', async () => {
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT + 5,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		handle.kernel.issueCache.getState = issueStillOpen
		const dep = dummySkipSuite('__skip_pass_dep__', SKIP_URL)
		const depKey = 'testkit:__skip_pass_dep__'
		const childKey = 'testkit:__skip_pass_child__'
		const child = {
			manifestId: 'testkit',
			name: '__skip_pass_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__skip_pass_dep__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(child)
		handle.kernel.catalog.byKey.set(childKey, child)
		handle.kernel.state.suites[depKey] = {
			status: 'failed',
			durationMs: 0,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		}
		const { end: skipEnd } = await enqueueAndAwaitSkip(handle.kernel, dep, 'skip-pass-dep')
		assertEquals(skipEnd?.passed, true)

		const { job, end } = enqueueDummyJob(handle.kernel, { key: childKey, jobId: 'skip-pass-child' })
		handle.kernel.wake()
		await awaitJob(job, 'child stayed queued after skip-pass dep')
		assertEquals(end()?.blockedBy ?? [], [])
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because delay: closed within delay passes; expired fails', async () => {
	const handle = await startTestKernel({
		port: SKIP_KERNEL_PORT + 6,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		handle.kernel.issueCache.getState = async () => ({ closed: true, closedAt: Date.now() - 1000 })
		const { end: within } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_delay_within__', { url: SKIP_URL, delay: '14d' }),
			'skip-delay-within',
		)
		assertEquals(within?.passed, true)
		assertEquals(within?.skipBecause, [SKIP_URL])
		assertEquals(within?.skipBecauseClosed ?? [], [])

		handle.kernel.issueCache.getState = async () => ({ closed: true, closedAt: Date.now() - 20 * 86_400_000 })
		const { end: expired, job } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_delay_expired__', { url: SKIP_URL, delay: '14d' }),
			'skip-delay-expired',
		)
		assertEquals(expired?.passed, false)
		assertEquals(expired?.skipBecauseClosed, [SKIP_URL])
		assertEquals(Boolean(expired?.output), true)
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})


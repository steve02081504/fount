/**
 * 内核单例、退出、skip_because 不 spawn、模组检查 HTTP。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { execFile } from 'npm:@steve02081504/exec'

import { reportJsonPath, reportMarkdownPath, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { REPO_ROOT } from '../core/repo_root.mjs'
import { parseSkipBecause } from '../core/skip_because.mjs'
import {
	abandonModuleCheckTicket,
	acquireModuleCheckTicket,
	ModuleCheckMissedReadyError,
	signalModuleCheckReady,
	withDenoModuleCheckPreload,
	withModuleCheckTicket,
} from '../hub/clients/module_check.mjs'
import { ignoreWatchPath } from '../kernel/runtime.mjs'
import { startTestKernel } from '../kernel/server.mjs'

/** 避开生产 8903 与 hub 自测 18903。 */
const KERNEL_PORT = 18904
const SKIP_URL = 'https://github.com/denoland/deno/issues/35804'

/**
 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 视为未关
 */
async function issueStillOpen() {
	return { closed: false, closedAt: null }
}

/**
 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 视为已关（epoch，delay 0 立即过期）
 */
async function issueClosed() {
	return { closed: true, closedAt: 0 }
}

/**
 * @param {string} name dummy suite 名
 * @param {unknown} skipBecause skip_because 原始字段
 * @returns {object} suite
 */
function dummySkipSuite(name, skipBecause) {
	return {
		manifestId: 'testkit',
		name,
		skipBecause: parseSkipBecause(skipBecause, `suite "${name}"`),
		run: ['true'],
		triggers: [],
		dependencies: [],
		heavy: false,
	}
}

Deno.test('ignoreWatchPath drops git, node_modules, debug_logs, data/test', () => {
	assertEquals(ignoreWatchPath('.git/HEAD'), true)
	assertEquals(ignoreWatchPath('foo/node_modules/x'), true)
	assertEquals(ignoreWatchPath('debug_logs/a'), true)
	assertEquals(ignoreWatchPath('data/test/report.md'), true)
	assertEquals(ignoreWatchPath('src/scripts/test/cli.mjs'), false)
	assertEquals(ignoreWatchPath('data/users/u/chars/c/test/manifest.json'), false)
})

Deno.test('kernel auto-exits when queues empty and no watch WS', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT,
		autoExit: true,
		watchFs: false,
		writeReport: false,
	})
	const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', reject, { once: true })
	})
	ws.send(JSON.stringify({ type: 'hello', watch: false }))
	await new Promise(resolve => setTimeout(resolve, 50))
	ws.close()
	await handle.closed
})

Deno.test('second kernel listen EADDRINUSE; first stays healthy', async () => {
	const first = await startTestKernel({
		port: KERNEL_PORT + 1,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const health = await fetch(`${first.url}/health`)
		assertEquals(health.status, 200)
		await assertRejects(
			() => startTestKernel({
				port: KERNEL_PORT + 1,
				autoExit: false,
				watchFs: false,
				writeReport: false,
			}),
		)
		const again = await fetch(`${first.url}/health`)
		assertEquals(again.status, 200)
	}
	finally {
		await first.close()
	}
})

Deno.test('watch WS keeps kernel alive until disconnect', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 2,
		autoExit: true,
		watchFs: false,
		writeReport: false,
	})
	const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true })
		ws.addEventListener('error', reject, { once: true })
	})
	const accepted = new Promise(resolve => {
		ws.addEventListener('message', event => {
			const msg = JSON.parse(String(event.data))
			if (msg.type === 'accepted') resolve()
		}, { once: true })
	})
	ws.send(JSON.stringify({ type: 'hello', watch: true }))
	await accepted
	assertEquals(handle.kernel.viewers.watchCount(), 1)
	assertEquals(handle.kernel.closed, false)
	ws.close()
	await handle.closed
})

/**
 * @param {import('../kernel/runtime.mjs').TestKernel} kernel 内核
 * @param {object} suite dummy suite
 * @param {string} jobId job
 * @returns {Promise<{ end: object | null, job: object }>} 结束事件与 job
 */
async function enqueueAndAwaitSkip(kernel, suite, jobId) {
	const key = `${suite.manifestId}:${suite.name}`
	kernel.catalog.allSuites.push(suite)
	kernel.catalog.byKey.set(key, suite)
	/** @type {object | null} */
	let end = null
	kernel.viewers.add({
		readyState: 1,
		/**
		 * @param {string} raw 事件 JSON
		 * @returns {void}
		 */
		send: raw => {
			const msg = JSON.parse(raw)
			if (msg.type === 'suite-end') end = msg
		},
	}, { mode: 'overview' })
	const item = kernel.queues.enqueueCli({ key, viewerId: 'v', jobId })
	const job = {
		id: jobId,
		viewerId: 'v',
		spec: {},
		pending: new Set([item.id]),
		probedSkip: new Set(),
		continueLoop: false,
		exitCode: 0,
		done: Promise.withResolvers(),
		fingerprints: { commitHash: null, uncommittedHash: null },
	}
	kernel.jobs.set(job.id, job)
	kernel.wake()
	await job.done.promise
	return { end, job }
}

Deno.test('skip_because open does not spawn and counts as pass', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 3,
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
		port: KERNEL_PORT + 4,
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
		port: KERNEL_PORT + 6,
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

Deno.test('module-check HTTP: second acquire waits for ready', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	const handle = await startTestKernel({
		port: KERNEL_PORT + 5,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	process.env.FOUNT_TEST_HUB_URL = handle.url
	try {
		const first = await acquireModuleCheckTicket()
		let second
		const pending = acquireModuleCheckTicket().then(ticket => { second = ticket })
		await new Promise(resolve => setTimeout(resolve, 30))
		assertEquals(second, undefined)
		await signalModuleCheckReady(first)
		await pending
		assertEquals(Boolean(second), true)
		await signalModuleCheckReady(second)

		const held = await acquireModuleCheckTicket()
		let unblocked
		const waiting = acquireModuleCheckTicket().then(ticket => { unblocked = ticket })
		await new Promise(resolve => setTimeout(resolve, 30))
		assertEquals(unblocked, undefined)
		assertEquals(await abandonModuleCheckTicket(held), true)
		await waiting
		assertEquals(Boolean(unblocked), true)
		assertEquals(await abandonModuleCheckTicket(unblocked), true)

		const afterReady = await acquireModuleCheckTicket()
		await signalModuleCheckReady(afterReady)
		assertEquals(await abandonModuleCheckTicket(afterReady), false)

		await assertRejects(() => withModuleCheckTicket(async () => {}), ModuleCheckMissedReadyError)
		const afterMissed = await acquireModuleCheckTicket()
		assertEquals(Boolean(afterMissed), true)
		await signalModuleCheckReady(afterMissed)

		try {
			await withModuleCheckTicket(async () => { throw new Error('spawn failed') })
			throw new Error('expected throw')
		}
		catch (error) {
			assertEquals(error instanceof ModuleCheckMissedReadyError, false)
			assertEquals(error.message, 'spawn failed')
		}
		const afterSpawnFail = await acquireModuleCheckTicket()
		assertEquals(Boolean(afterSpawnFail), true)
		await signalModuleCheckReady(afterSpawnFail)
	}
	finally {
		await handle.close()
		if (previous === undefined) delete process.env.FOUNT_TEST_HUB_URL
		else process.env.FOUNT_TEST_HUB_URL = previous
	}
})

Deno.test('empty default job announces empty, does not write in-progress report, auto-exits after viewer leaves', async () => {
	const root = join(tmpdir(), `fount-kernel-empty-${Date.now()}`)
	await mkdir(root, { recursive: true })
	try {
		const init = await execFile('git', ['init', '-b', 'main'], { cwd: root })
		assertEquals(init.code, 0)
		const commit = await execFile('git', [
			'-c', 'user.email=t@t', '-c', 'user.name=t',
			'commit', '--allow-empty', '-m', 'init',
		], { cwd: root })
		assertEquals(commit.code, 0)
		const handle = await startTestKernel({
			port: KERNEL_PORT + 10,
			repoRoot: root,
			autoExit: true,
			watchFs: false,
			writeReport: true,
		})
		const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
		await new Promise((resolve, reject) => {
			ws.addEventListener('open', resolve, { once: true })
			ws.addEventListener('error', reject, { once: true })
		})
		const accepted = new Promise(resolve => {
			ws.addEventListener('message', event => {
				const msg = JSON.parse(String(event.data))
				if (msg.type === 'accepted') resolve(msg)
			})
		})
		ws.send(JSON.stringify({ type: 'hello', watch: false, job: {} }))
		const msg = await accepted
		assertEquals(msg.empty, true)
		assertEquals(msg.runCount, 0)
		assertEquals(msg.code, 0)
		assertEquals(msg.error, null)
		await assertRejects(() => readFile(reportMarkdownPath(root), 'utf8'))
		ws.close()
		await handle.closed
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('accepted precedes suite-start and remaining drops the finished suite', async () => {
	const root = join(tmpdir(), `fount-kernel-eta-${Date.now()}`)
	await mkdir(root, { recursive: true })
	try {
		const init = await execFile('git', ['init', '-b', 'main'], { cwd: root })
		assertEquals(init.code, 0)
		const commit = await execFile('git', [
			'-c', 'user.email=t@t', '-c', 'user.name=t',
			'commit', '--allow-empty', '-m', 'init',
		], { cwd: root })
		assertEquals(commit.code, 0)
		const handle = await startTestKernel({
			port: KERNEL_PORT + 11,
			repoRoot: root,
			autoExit: false,
			watchFs: false,
			writeReport: true,
		})
		try {
			handle.kernel.issueCache.getState = issueStillOpen
			const short = dummySkipSuite('__eta_short__', SKIP_URL)
			const long = dummySkipSuite('__eta_long__', SKIP_URL)
			short.heavy = true
			long.heavy = true
			handle.kernel.catalog.allSuites.push(short, long)
			handle.kernel.catalog.byKey.set('testkit:__eta_short__', short)
			handle.kernel.catalog.byKey.set('testkit:__eta_long__', long)
			handle.kernel.state.suites['testkit:__eta_short__'] = {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 100,
				baselineDurationMs: 1000,
				triggerHash: null,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			}
			handle.kernel.state.suites['testkit:__eta_long__'] = {
				status: 'failed',
				commitHash: 'abc',
				uncommittedHash: null,
				ranAt: '',
				durationMs: 100,
				baselineDurationMs: 10_000,
				triggerHash: null,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			}

			const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
			await new Promise((resolve, reject) => {
				ws.addEventListener('open', resolve, { once: true })
				ws.addEventListener('error', reject, { once: true })
			})
			/** @type {object[]} */
			const events = []
			const done = new Promise(resolve => {
				ws.addEventListener('message', event => {
					const msg = JSON.parse(String(event.data))
					events.push(msg)
					if (msg.type === 'job-done') resolve()
				})
			})
			ws.send(JSON.stringify({ type: 'hello', watch: false, job: {} }))
			await done
			ws.close()

			const types = events.map(msg => msg.type)
			assertEquals(types.indexOf('accepted') >= 0, true)
			assertEquals(types.indexOf('accepted') < types.indexOf('suite-start'), true)
			const accepted = events.find(msg => msg.type === 'accepted')
			assertEquals(accepted?.mode, 'overview')
			assertEquals(accepted?.runCount, 2)
			assertEquals((accepted?.continueReasons ?? []).map(row => row.key).sort(), [
				'testkit:__eta_long__',
				'testkit:__eta_short__',
			])
			assertEquals(accepted?.remainingMs >= 10_000, true)

			const firstEnd = events.find(msg => msg.type === 'suite-end')
			const lastEnd = events.filter(msg => msg.type === 'suite-end').at(-1)
			assertEquals(firstEnd?.remainingMs <= 10_000 + 1000, true)
			assertEquals(firstEnd?.remainingMs < (accepted?.remainingMs ?? 0), true)
			assertEquals(lastEnd?.remainingMs, 0)

			const reasonsText = await readFile(triggeredReasonsMarkdownPath(root), 'utf8')
			assertEquals(reasonsText.includes('历史失败'), true)
			const report = JSON.parse(await readFile(reportJsonPath(root), 'utf8'))
			assertEquals(report.slots.every(slot => slot.continueReason?.kind), true)
		}
		finally {
			await handle.close()
		}
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('module-check preload releases before deno test body', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	const handle = await startTestKernel({
		port: KERNEL_PORT + 12,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	process.env.FOUNT_TEST_HUB_URL = handle.url
	const dir = join(tmpdir(), `fount-mc-preload-${Date.now()}`)
	await mkdir(dir, { recursive: true })
	const file = join(dir, 'hold.test.mjs')
	await writeFile(file, 'await new Promise(resolve => setTimeout(resolve, 1500))\nDeno.test("n", () => {})\n')
	/** @type {import('node:child_process').ChildProcess | undefined} */
	let child
	try {
		const ticket = await acquireModuleCheckTicket()
		child = spawn(Deno.execPath(), withDenoModuleCheckPreload([
			'test', '--no-check', '--allow-scripts', '--allow-all',
			'-c', join(REPO_ROOT, 'deno.json'),
			file,
		], ticket), {
			cwd: REPO_ROOT,
			stdio: 'ignore',
			env: {
				...process.env,
				FOUNT_TEST_HUB_URL: handle.url,
				FOUNT_TEST_MODULE_CHECK_TICKET: ticket,
			},
		})
		const second = await Promise.race([
			acquireModuleCheckTicket(),
			new Promise((_, reject) => setTimeout(() => reject(new Error('second acquire hung')), 8000)),
		])
		assertEquals(Boolean(second), true)
		assertEquals(child.exitCode, null)
		await signalModuleCheckReady(second)
		await new Promise((resolve, reject) => {
			child.once('exit', resolve)
			child.once('error', reject)
		})
	}
	finally {
		child?.kill()
		await handle.close()
		await rm(dir, { recursive: true, force: true })
		if (previous === undefined) delete process.env.FOUNT_TEST_HUB_URL
		else process.env.FOUNT_TEST_HUB_URL = previous
	}
})

Deno.test('failed dep discards queued dependents as blocked', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 13,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const depKey = 'testkit:__dep_failed__'
		const childKey = 'testkit:__dep_child__'
		const dep = {
			manifestId: 'testkit',
			name: '__dep_failed__',
			run: ['true'],
			triggers: [],
			dependencies: [],
			heavy: false,
		}
		const child = {
			manifestId: 'testkit',
			name: '__dep_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__dep_failed__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(dep, child)
		handle.kernel.catalog.byKey.set(depKey, dep)
		handle.kernel.catalog.byKey.set(childKey, child)
		handle.kernel.sessionPassed.set(depKey, false)
		handle.kernel.state.suites[depKey] = {
			status: 'failed',
			durationMs: 0,
			failedFiles: [],
			noiseHits: [],
			logPath: null,
		}
		/** @type {object | null} */
		let end = null
		handle.kernel.viewers.add({
			readyState: 1,
			/**
			 * @param {string} raw 事件 JSON
			 * @returns {void}
			 */
			send: raw => {
				const msg = JSON.parse(raw)
				if (msg.type === 'suite-end' && msg.key === childKey) end = msg
			},
		}, { mode: 'overview' })
		const item = handle.kernel.queues.enqueueCli({ key: childKey, viewerId: 'v', jobId: 'dep-block' })
		const job = {
			id: 'dep-block',
			viewerId: 'v',
			spec: {},
			pending: new Set([item.id]),
			probedSkip: new Set(),
			continueLoop: false,
			exitCode: 0,
			done: Promise.withResolvers(),
			fingerprints: { commitHash: null, uncommittedHash: null },
		}
		handle.kernel.jobs.set(job.id, job)
		handle.kernel.wake()
		await Promise.race([
			job.done.promise,
			new Promise((_, reject) => setTimeout(() => reject(new Error('dependent stayed queued after dep failed')), 5000)),
		])
		assertEquals(end?.passed, false)
		assertEquals(end?.blockedBy, [depKey])
		assertEquals(job.exitCode, 1)
		assertEquals(handle.kernel.queues.pendingEmpty(), true)
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because pass unblocks dependents despite stale failed state', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 16,
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

		/** @type {object | null} */
		let childEnd = null
		handle.kernel.viewers.add({
			readyState: 1,
			/**
			 * @param {string} raw 事件 JSON
			 * @returns {void}
			 */
			send: raw => {
				const msg = JSON.parse(raw)
				if (msg.type === 'suite-end' && msg.key === childKey) childEnd = msg
			},
		}, { mode: 'overview' })
		const item = handle.kernel.queues.enqueueCli({ key: childKey, viewerId: 'v', jobId: 'skip-pass-child' })
		const job = {
			id: 'skip-pass-child',
			viewerId: 'v',
			spec: {},
			pending: new Set([item.id]),
			probedSkip: new Set(),
			continueLoop: false,
			exitCode: 0,
			done: Promise.withResolvers(),
			fingerprints: { commitHash: null, uncommittedHash: null },
		}
		handle.kernel.jobs.set(job.id, job)
		handle.kernel.wake()
		await Promise.race([
			job.done.promise,
			new Promise((_, reject) => setTimeout(() => reject(new Error('child stayed queued after skip-pass dep')), 8000)),
		])
		assertEquals(childEnd?.blockedBy ?? [], [])
	}
	finally {
		await handle.close()
	}
})

Deno.test('skip_because delay: closed within delay passes; expired fails', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 14,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		/**
		 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 刚关闭
		 */
		handle.kernel.issueCache.getState = async () => ({ closed: true, closedAt: Date.now() - 1000 })
		const { end: within } = await enqueueAndAwaitSkip(
			handle.kernel,
			dummySkipSuite('__skip_delay_within__', { url: SKIP_URL, delay: '14d' }),
			'skip-delay-within',
		)
		assertEquals(within?.passed, true)
		assertEquals(within?.skipBecause, [SKIP_URL])
		assertEquals(within?.skipBecauseClosed ?? [], [])

		/**
		 * @returns {Promise<{ closed: boolean, closedAt: number | null }>} 关闭已超过 14 天
		 */
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

Deno.test('module-check missed ready fails the deno suite', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 15,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const suite = {
			manifestId: 'testkit',
			name: '__missed_ready__',
			run: ['deno', 'eval', 'undefined'],
			triggers: [],
			dependencies: [],
			heavy: false,
		}
		const { end, job } = await enqueueAndAwaitSkip(handle.kernel, suite, 'missed-ready')
		assertEquals(end?.passed, false)
		assertEquals(end?.missedReady, true)
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})

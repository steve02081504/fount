/**
 * 内核单例、退出、空波次与依赖丢弃。
 */
/* global Deno */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { execFile } from 'npm:@steve02081504/exec'

import { ms } from '../../ms.mjs'
import { reportJsonPath, reportMarkdownPath, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { waitUntil } from '../core/wait.mjs'
import { startTestHub, testHubUrl } from '../hub/index.mjs'
import { kernelHealthy, parseNetstatListenPid, rebootTestKernel, shutdownTestKernel } from '../kernel/ensure.mjs'
import { ignoreWatchPath } from '../kernel/runtime.mjs'
import { startTestKernel } from '../kernel/server.mjs'

import {
	awaitJob,
	awaitWithTimeout,
	dummySkipSuite,
	enqueueDummyJob,
	issueClosed,
	issueStillOpen,
	KERNEL_PORT,
	SKIP_URL,
} from './kernel_fixtures.mjs'

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
			const message = JSON.parse(String(event.data))
			if (message.type === 'accepted') resolve()
		}, { once: true })
	})
	ws.send(JSON.stringify({ type: 'hello', watch: true }))
	await accepted
	assertEquals(handle.kernel.viewers.watchCount(), 1)
	assertEquals(handle.kernel.closed, false)
	ws.close()
	await handle.closed
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
				const message = JSON.parse(String(event.data))
				if (message.type === 'accepted') resolve(message)
			})
		})
		ws.send(JSON.stringify({ type: 'hello', watch: false, job: {} }))
		const message = await accepted
		assertEquals(message.empty, true)
		assertEquals(message.runCount, 0)
		assertEquals(message.code, 0)
		assertEquals(message.error, null)
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
					const message = JSON.parse(String(event.data))
					events.push(message)
					if (message.type === 'job-done') resolve()
				})
			})
			ws.send(JSON.stringify({ type: 'hello', watch: false, job: {} }))
			await done
			ws.close()

			const types = events.map(message => message.type)
			assertEquals(types.indexOf('accepted') >= 0, true)
			assertEquals(types.indexOf('accepted') < types.indexOf('suite-start'), true)
			const accepted = events.find(message => message.type === 'accepted')
			assertEquals(accepted?.mode, 'overview')
			assertEquals(accepted?.runCount, 2)
			assertEquals((accepted?.continueReasons ?? []).map(row => row.key).sort(), [
				'testkit:__eta_long__',
				'testkit:__eta_short__',
			])
			assertEquals(accepted?.remainingMs >= 10_000, true)

			const firstEnd = events.find(message => message.type === 'suite-end')
			const lastEnd = events.filter(message => message.type === 'suite-end').at(-1)
			assertEquals(firstEnd?.remainingMs <= 10_000 + 1000, true)
			assertEquals(firstEnd?.remainingMs < (accepted?.remainingMs ?? 0), true)
			assertEquals(lastEnd?.remainingMs, 0)

			const reasonsText = await readFile(triggeredReasonsMarkdownPath(root), 'utf8')
			assertEquals(reasonsText.includes('skip_because 复检'), true)
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
		const { job, end } = enqueueDummyJob(handle.kernel, { key: childKey, jobId: 'dep-block' })
		handle.kernel.wake()
		await awaitJob(job, 'dependent stayed queued after dep failed', 5000)
		assertEquals(end()?.passed, false)
		assertEquals(end()?.blockedBy, [depKey])
		assertEquals(job.exitCode, 1)
		assertEquals(handle.kernel.queues.pendingEmpty(), true)
	}
	finally {
		await handle.close()
	}
})

Deno.test('accepted remaining includes already-running leftover', async () => {
	const root = join(tmpdir(), `fount-kernel-wait-eta-${Date.now()}`)
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
			port: KERNEL_PORT + 14,
			repoRoot: root,
			autoExit: false,
			watchFs: false,
			writeReport: false,
		})
		try {
			const blocker = {
				manifestId: 'testkit',
				name: '__wait_block__',
				run: ['true'],
				triggers: [],
				dependencies: [],
				heavy: true,
				expectedMs: 60_000,
			}
			const next = {
				manifestId: 'testkit',
				name: '__wait_next__',
				run: ['true'],
				triggers: [],
				dependencies: [],
				heavy: true,
				expectedMs: 1000,
			}
			handle.kernel.catalog.allSuites.push(blocker, next)
			handle.kernel.catalog.byKey.set('testkit:__wait_block__', blocker)
			handle.kernel.catalog.byKey.set('testkit:__wait_next__', next)
			handle.kernel.state.suites['testkit:__wait_block__'] = {
				status: 'failed',
				durationMs: 1000,
				baselineDurationMs: 60_000,
				failedFiles: [],
				noiseHits: [],
				logPath: null,
			}
			handle.kernel.running.set('testkit:__wait_block__', {
				item: { id: 'run-block', key: 'testkit:__wait_block__' },
				startedAt: Date.now(),
				checkDone: true,
			})
			const submitted = await handle.kernel.submitJob({
				force: true,
				groups: [{
					manifestSelectors: ['testkit'],
					suiteSelectors: ['__wait_next__'],
					subtestSelectors: {},
				}],
			}, 'v-wait')
			assertEquals(submitted.runCount, 1)
			assertEquals(submitted.remainingMs > 50_000, true, `remainingMs=${submitted.remainingMs}`)
		}
		finally {
			handle.kernel.running.clear()
			await handle.close()
		}
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

/** 避开 skip_because 18920 段与 module_check 18940 段。 */
const CONTROL_PORT = 18930

Deno.test('parseNetstatListenPid reads LISTENING pid and ignores longer ports', () => {
	const stdout = [
		'  TCP    127.0.0.1:89030        0.0.0.0:0              LISTENING       1',
		'  TCP    127.0.0.1:8903         0.0.0.0:0              LISTENING       4242',
	].join('\n')
	assertEquals(parseNetstatListenPid(stdout, 8903), 4242)
	assertEquals(parseNetstatListenPid(stdout, 89030), 1)
	assertEquals(parseNetstatListenPid(stdout, 80), 0)
})

Deno.test('POST /shutdown stops the in-process kernel', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	assertEquals(await kernelHealthy(handle.url), true)
	const res = await fetch(`${handle.url}/shutdown`, { method: 'POST' })
	assertEquals(res.ok, true)
	await awaitWithTimeout(handle.closed, 'kernel did not close after /shutdown')
	assertEquals(await kernelHealthy(handle.url), false)
})

Deno.test('POST /shutdown rejects Origin-bearing requests', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 7,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		assertEquals(await kernelHealthy(handle.url), true)
		const res = await fetch(`${handle.url}/shutdown`, {
			method: 'POST',
			headers: { Origin: 'http://example.test' },
		})
		assertEquals(res.status, 403)
		assertEquals(await kernelHealthy(handle.url), true)
	}
	finally {
		await handle.close()
	}
})

Deno.test('GET /status reports running and queued suites', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 12,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const idle = await fetch(`${handle.url}/status`)
		assertEquals(idle.status, 200)
		const idleBody = await idle.json()
		assertEquals(idleBody.online, true)
		assertEquals(idleBody.active, false)
		assertEquals(idleBody.idle, true)
		assertEquals(idleBody.runningSuites.length, 0)
		assertEquals(idleBody.queuedSuites.length, 0)

		const runningKey = 'testkit:__status__'
		handle.kernel.running.set(runningKey, {
			item: { key: runningKey },
			startedAt: Date.now(),
			checkDone: true,
		})
		const queuedKey = 'testkit:__status_q__'
		handle.kernel.queues.enqueueCli({ key: queuedKey, viewerId: 'v', jobId: 'status' })

		const active = await fetch(`${handle.url}/status`)
		const activeBody = await active.json()
		assertEquals(activeBody.online, true)
		assertEquals(activeBody.active, true)
		assertEquals(activeBody.idle, false)
		assertEquals(activeBody.runningSuites[0]?.key, runningKey)
		assertEquals(typeof activeBody.runningSuites[0]?.elapsedMs, 'number')
		assertEquals(activeBody.queuedSuites, [queuedKey])

		const prepKey = 'testkit:__status_prep__'
		handle.kernel.queues.hitPrep(prepKey, 'fs_change')
		const statusBody = await (await fetch(`${handle.url}/status`)).json()
		assertEquals(statusBody.active, true)
		assertEquals(statusBody.queuedSuites.includes(prepKey), true)
	}
	finally {
		handle.kernel.running.delete('testkit:__status__')
		await handle.close()
	}
})

Deno.test('shutdownTestKernel returns already_down when nothing is listening', async () => {
	assertEquals(await shutdownTestKernel({ port: CONTROL_PORT + 1, timeoutMs: 1000 }), 'already_down')
})

Deno.test('kernelHealthy rejects generic hub /health', async () => {
	const hub = await startTestHub({ port: CONTROL_PORT + 5 })
	try {
		assertEquals(await kernelHealthy(hub.url), false)
		assertEquals(await shutdownTestKernel({ port: CONTROL_PORT + 5, timeoutMs: 1000 }), 'already_down')
	}
	finally {
		await hub.close()
	}
})

Deno.test('shutdownTestKernel stops a running kernel', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 2,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		assertEquals(await shutdownTestKernel({ port: CONTROL_PORT + 2 }), 'stopped')
		await awaitWithTimeout(handle.closed, 'kernel did not close after shutdownTestKernel')
		assertEquals(await kernelHealthy(handle.url), false)
	}
	finally {
		await handle.close()
	}
})

Deno.test('kernel close settles one running item and one queued item', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 6,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const { job } = enqueueDummyJob(handle.kernel, { key: 'testkit:__run__', jobId: 'close-drain' })
		const runningItem = handle.kernel.queues.cli.find(item => item.key === 'testkit:__run__')
		handle.kernel.queues.cli = handle.kernel.queues.cli.filter(item => item !== runningItem)
		const queuedItem = handle.kernel.queues.enqueueCli({
			key: 'testkit:__queued__',
			viewerId: 'v',
			jobId: job.id,
		})
		job.pending.add(queuedItem.id)
		const abort = new AbortController()
		handle.kernel.running.set('testkit:__run__', {
			item: runningItem,
			abort,
			startedAt: Date.now(),
			checkDone: true,
		})
		abort.signal.addEventListener('abort', () => {
			setTimeout(() => {
				handle.kernel.running.delete('testkit:__run__')
			}, 80)
		}, { once: true })
		assertEquals(handle.kernel.running.size, 1)
		assertEquals(handle.kernel.queues.cli.length, 1)
		await awaitWithTimeout(handle.close(), 'close did not drain running and queued items')
		assertEquals(handle.kernel.running.size, 0)
		assertEquals(handle.kernel.queues.cli.length, 0)
		await awaitWithTimeout(job.done.promise, 'job did not settle on close')
	}
	finally {
		handle.kernel.running.delete('testkit:__run__')
		await handle.close()
	}
})

Deno.test('kernel close aborts running suites', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 3,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		const abort = new AbortController()
		handle.kernel.running.set('testkit:__abort__', {
			item: { key: 'testkit:__abort__' },
			abort,
			startedAt: Date.now(),
			checkDone: true,
		})
		const aborted = new Promise(resolve => {
			abort.signal.addEventListener('abort', () => {
				setTimeout(() => {
					handle.kernel.running.delete('testkit:__abort__')
					resolve()
				}, 80)
			}, { once: true })
		})
		const closing = handle.close()
		assertEquals(handle.kernel.running.has('testkit:__abort__'), true)
		await awaitWithTimeout(closing, 'close returned before running suite drained')
		assertEquals(handle.kernel.running.size, 0)
		await awaitWithTimeout(aborted, 'close did not abort running suite')
	}
	finally {
		handle.kernel.running.delete('testkit:__abort__')
		await handle.close()
	}
})

Deno.test('submitJob cancels queued and running idle_all items', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 22,
		autoExit: false,
		watchFs: false,
		writeReport: false,
		autoUpdateExpected: false,
	})
	try {
		const k = handle.kernel
		const abort = new AbortController()
		k.running.set('testkit:__idle_run__', {
			item: { key: 'testkit:__idle_run__', reason: 'idle_all' },
			abort,
			startedAt: Date.now(),
			checkDone: true,
		})
		k.queues.enqueueFs('testkit:__idle_q__', 'idle_all')
		k.queues.enqueueFs('testkit:__normal__', 'fs_change')
		// 提交一个必空 job（不激活波次）也会在开头触发抢占。
		const preemptJob = () => k.submitJob({
			groups: [{
				manifestSelectors: ['testkit'],
				suiteSelectors: ['__no_such_suite__'],
				subtestSelectors: {},
			}],
		}, 'v-preempt')
		await preemptJob()
		assertEquals(k.queues.fs.map(item => item.key), ['testkit:__normal__'])
		assertEquals(abort.signal.aborted, true)
		assertEquals(String(abort.signal.reason), 'new_job')
		// 清空 running/队列后，无 idle_all 可取消时不再误重置闲置计时。
		k.running.delete('testkit:__idle_run__')
		k.queues.fs = []
		const before = k.lastIdleAt
		await preemptJob()
		assertEquals(k.lastIdleAt, before)
	}
	finally {
		handle.kernel.running.delete('testkit:__idle_run__')
		await handle.close()
	}
})

Deno.test('rebootTestKernel starts a kernel when none is running', async () => {
	const port = CONTROL_PORT + 4
	try {
		assertEquals(await kernelHealthy(testHubUrl(port)), false)
		const url = await rebootTestKernel({ port })
		assertEquals(url, testHubUrl(port))
		assertEquals(await kernelHealthy(url), true)
	}
	finally {
		await shutdownTestKernel({ port })
	}
})

Deno.test('last suite of a job does not emit job-wait after job-done while others are busy', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 8,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	try {
		/** @type {object[]} */
		const events = []
		const viewer = handle.kernel.viewers.add({
			readyState: 1,
			/**
			 * @param {string} raw 事件 JSON
			 * @returns {void}
			 */
			send: raw => { events.push(JSON.parse(raw)) },
		}, { mode: 'overview' })
		const suite = {
			manifestId: 'testkit',
			name: '__job_wait_last__',
			run: ['true'],
			triggers: [],
			dependencies: [],
			heavy: false,
		}
		const key = 'testkit:__job_wait_last__'
		handle.kernel.catalog.allSuites.push(suite)
		handle.kernel.catalog.byKey.set(key, suite)
		handle.kernel.running.set('testkit:__other_busy__', {
			item: { key: 'testkit:__other_busy__', jobId: 'other-job' },
			abort: new AbortController(),
			startedAt: Date.now(),
			checkDone: true,
		})
		const jobId = 'job-wait-last'
		viewer.jobId = jobId
		const item = handle.kernel.queues.enqueueCli({ key, viewerId: viewer.id, jobId })
		const job = {
			id: jobId,
			viewerId: viewer.id,
			spec: {},
			pending: new Set([item.id]),
			probedSkip: new Set(),
			continueLoop: false,
			exitCode: 0,
			done: Promise.withResolvers(),
			fingerprints: { commitHash: null, uncommittedHash: null },
		}
		handle.kernel.jobs.set(jobId, job)
		handle.kernel.wake()
		await awaitJob(job, 'job-wait-last timed out')
		const types = events.map(event => event.type)
		const suiteEndAt = types.indexOf('suite-end')
		assertEquals(suiteEndAt >= 0, true)
		assertEquals(types.slice(suiteEndAt).includes('job-wait'), false)
		const jobDoneAt = types.indexOf('job-done')
		assertEquals(jobDoneAt >= 0, true)
		assertEquals(types.slice(jobDoneAt).includes('job-wait'), false)
	}
	finally {
		handle.kernel.running.delete('testkit:__other_busy__')
		await handle.close()
	}
})

/**
 * 占住别的 job，使本 job 的 job-wait 有 aheadCount。
 * @param {import('../kernel/runtime.mjs').TestKernel} kernel 内核
 * @returns {() => void} 清理
 */
function holdOtherBusy(kernel) {
	kernel.running.set('testkit:__other_busy__', {
		item: { key: 'testkit:__other_busy__', jobId: 'other-job' },
		abort: new AbortController(),
		startedAt: Date.now(),
		checkDone: true,
	})
	return () => kernel.running.delete('testkit:__other_busy__')
}

/**
 * 同 job 入队多项并收集 viewer 事件。
 * @param {import('../kernel/runtime.mjs').TestKernel} kernel 内核
 * @param {object} spec 项
 * @param {string[]} spec.keys suite 键
 * @param {string} spec.jobId job
 * @returns {{ job: object, events: object[] }} job 与事件
 */
function enqueueJobKeys(kernel, { keys, jobId }) {
	/** @type {object[]} */
	const events = []
	const viewer = kernel.viewers.add({
		readyState: 1,
		/**
		 * @param {string} raw 事件 JSON
		 * @returns {void}
		 */
		send: raw => { events.push(JSON.parse(raw)) },
	}, { mode: 'overview' })
	viewer.jobId = jobId
	const pending = new Set()
	for (const key of keys) {
		const item = kernel.queues.enqueueCli({ key, viewerId: viewer.id, jobId })
		pending.add(item.id)
	}
	const job = {
		id: jobId,
		viewerId: viewer.id,
		spec: {},
		pending,
		probedSkip: new Set(),
		continueLoop: false,
		exitCode: 0,
		done: Promise.withResolvers(),
		fingerprints: { commitHash: null, uncommittedHash: null },
	}
	kernel.jobs.set(jobId, job)
	return { job, events }
}

/**
 * @param {object[]} events viewer 事件
 * @returns {void}
 */
function assertDiscardJobHasNoJobWait(events) {
	const types = events.map(event => event.type)
	assertEquals(types.includes('suite-end'), true)
	assertEquals(types.includes('job-done'), true)
	assertEquals(types.includes('job-wait'), false)
}

Deno.test('blocked dependent does not emit job-wait before job-done while others are busy', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 9,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	const releaseBusy = holdOtherBusy(handle.kernel)
	try {
		handle.kernel.issueCache.getState = issueClosed
		const dep = dummySkipSuite('__job_wait_block_dep__', SKIP_URL)
		const depKey = 'testkit:__job_wait_block_dep__'
		const childKey = 'testkit:__job_wait_block_child__'
		const child = {
			manifestId: 'testkit',
			name: '__job_wait_block_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__job_wait_block_dep__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(dep, child)
		handle.kernel.catalog.byKey.set(depKey, dep)
		handle.kernel.catalog.byKey.set(childKey, child)
		const { job, events } = enqueueJobKeys(handle.kernel, {
			keys: [depKey, childKey],
			jobId: 'job-wait-block',
		})
		handle.kernel.wake()
		await awaitJob(job, 'job-wait-block timed out')
		assertDiscardJobHasNoJobWait(events)
	}
	finally {
		releaseBusy()
		await handle.close()
	}
})

Deno.test('skip_tree dependent does not emit job-wait before job-done while others are busy', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 10,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	const releaseBusy = holdOtherBusy(handle.kernel)
	try {
		handle.kernel.issueCache.getState = issueStillOpen
		const dep = dummySkipSuite('__job_wait_skip_dep__', { url: SKIP_URL, as: 'skip_tree' })
		const depKey = 'testkit:__job_wait_skip_dep__'
		const childKey = 'testkit:__job_wait_skip_child__'
		const child = {
			manifestId: 'testkit',
			name: '__job_wait_skip_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__job_wait_skip_dep__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(dep, child)
		handle.kernel.catalog.byKey.set(depKey, dep)
		handle.kernel.catalog.byKey.set(childKey, child)
		const { job, events } = enqueueJobKeys(handle.kernel, {
			keys: [depKey, childKey],
			jobId: 'job-wait-skip',
		})
		handle.kernel.wake()
		await awaitJob(job, 'job-wait-skip timed out')
		assertDiscardJobHasNoJobWait(events)
	}
	finally {
		releaseBusy()
		await handle.close()
	}
})

Deno.test('promoted FS queue does not emit job-wait before discarding a blocked CLI job', async () => {
	const handle = await startTestKernel({
		port: CONTROL_PORT + 11,
		autoExit: false,
		watchFs: false,
		writeReport: false,
		prepSettleMs: 0,
	})
	const releaseBusy = holdOtherBusy(handle.kernel)
	try {
		const depKey = 'testkit:__job_wait_prep_dep__'
		const childKey = 'testkit:__job_wait_prep_child__'
		const fsKey = 'testkit:__job_wait_prep_fs__'
		const child = {
			manifestId: 'testkit',
			name: '__job_wait_prep_child__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__job_wait_prep_dep__' }],
			heavy: false,
		}
		const fsSuite = {
			manifestId: 'testkit',
			name: '__job_wait_prep_fs__',
			run: ['true'],
			triggers: [],
			dependencies: [{ manifestId: 'testkit', name: '__job_wait_prep_dep__' }],
			heavy: false,
		}
		handle.kernel.catalog.allSuites.push(child, fsSuite)
		handle.kernel.catalog.byKey.set(childKey, child)
		handle.kernel.catalog.byKey.set(fsKey, fsSuite)
		handle.kernel.sessionPassed.set(depKey, false)
		handle.kernel.queues.hitPrep(fsKey)
		const { job, events } = enqueueJobKeys(handle.kernel, {
			keys: [childKey],
			jobId: 'job-wait-prep',
		})
		handle.kernel.wake()
		await awaitJob(job, 'job-wait-prep timed out')
		assertDiscardJobHasNoJobWait(events)
	}
	finally {
		releaseBusy()
		await handle.close()
	}
})

Deno.test('idle clock starts when the run queue empties, not on a file change', async () => {
	const root = join(tmpdir(), `fount-kernel-idle-clock-${Date.now()}`)
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
			port: CONTROL_PORT + 20,
			repoRoot: root,
			autoExit: false,
			watchFs: false,
			writeReport: false,
			idleAllMs: ms('1h'),
			prepSettleMs: 0,
		})
		try {
			const triggeringPath = 'src/scripts/test/selftest/idle_clock.mjs'
			const suite = {
				manifestId: 'testkit',
				name: '__idle_clock__',
				run: ['true'],
				triggers: [triggeringPath],
				dependencies: [],
				heavy: false,
			}
			handle.kernel.catalog.allSuites.push(suite)
			handle.kernel.catalog.byKey.set('testkit:__idle_clock__', suite)
			await new Promise(resolve => setTimeout(resolve, 20))
			const before = handle.kernel.lastIdleAt
			// 未命中任何套件的改动不得重置闲置计时。
			handle.kernel.noteFileChange('docs/unrelated.md')
			await new Promise(resolve => setTimeout(resolve, 20))
			assertEquals(handle.kernel.lastIdleAt, before)
			// 有工作在跑时队列非空；跑完清空后计时才重置。
			handle.kernel.queues.enqueueFs('testkit:__idle_clock__', 'test')
			handle.kernel.wake()
			await waitUntil(() => handle.kernel.lastIdleAt > before, 4000)
		}
		finally {
			await handle.close()
		}
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('watch idle fires an automatic --all run after the idle window', async () => {
	const root = join(tmpdir(), `fount-kernel-idle-all-${Date.now()}`)
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
			port: CONTROL_PORT + 21,
			repoRoot: root,
			autoExit: false,
			watchFs: false,
			writeReport: false,
			idleAllMs: 200,
		})
		try {
			const key = 'testkit:__idle_all__'
			handle.kernel.catalog.allSuites.push({
				manifestId: 'testkit',
				name: '__idle_all__',
				run: ['true'],
				triggers: [],
				dependencies: [],
				heavy: false,
			})
			handle.kernel.catalog.byKey.set(key, {
				manifestId: 'testkit',
				name: '__idle_all__',
				run: ['true'],
				triggers: [],
				dependencies: [],
				heavy: false,
			})
			const ws = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
			await new Promise((resolve, reject) => {
				ws.addEventListener('open', resolve, { once: true })
				ws.addEventListener('error', reject, { once: true })
			})
			const started = new Promise(resolve => {
				ws.addEventListener('message', event => {
					const message = JSON.parse(String(event.data))
					if (message.type === 'suite-start' && message.key === key) resolve()
				})
			})
			ws.send(JSON.stringify({ type: 'hello', watch: true }))
			await awaitWithTimeout(started, 'idle-all did not run its suite', 4000)
			ws.close()
		}
		finally {
			await handle.close()
		}
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

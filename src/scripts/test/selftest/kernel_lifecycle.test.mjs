/**
 * 内核单例、退出、空波次与依赖丢弃。
 */
/* global Deno */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { execFile } from 'npm:@steve02081504/exec'

import { parseNetstatListenPid } from '../../listener.mjs'
import { ms } from '../../ms.mjs'
import { reportJsonPath, reportMarkdownPath, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { waitUntil } from '../core/wait.mjs'
import { startTestHub, testHubUrl } from '../hub/index.mjs'
import { kernelHealthy, rebootTestKernel, shutdownTestKernel } from '../kernel/ensure.mjs'
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

Deno.test('kernel idle-exit grace persists then exits when queues empty and no watch WS', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT,
		autoExit: true,
		watchFs: false,
		writeReport: false,
		idleExitGraceMs: 120,
	})
	try {
		const socket = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true })
			socket.addEventListener('error', reject, { once: true })
		})
		socket.send(JSON.stringify({ type: 'hello', watch: false }))
		await new Promise(resolve => setTimeout(resolve, 50))
		socket.close()
		// 宽限期内仍存活。
		await new Promise(resolve => setTimeout(resolve, 50))
		assertEquals(handle.kernel.closed, false)
		// 计时满后退出。
		await awaitWithTimeout(handle.closed, 'kernel did not exit after idle-exit grace')
	}
	finally {
		if (!handle.kernel.closed) await handle.close()
	}
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
		idleExitGraceMs: 120,
	})
	const socket = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true })
		socket.addEventListener('error', reject, { once: true })
	})
	const accepted = new Promise(resolve => {
		socket.addEventListener('message', event => {
			const message = JSON.parse(String(event.data))
			if (message.type === 'accepted') resolve()
		}, { once: true })
	})
	socket.send(JSON.stringify({ type: 'hello', watch: true }))
	await accepted
	assertEquals(handle.kernel.viewers.watchCount(), 1)
	assertEquals(handle.kernel.closed, false)
	socket.close()
	await handle.closed
})

Deno.test('idle-exit grace resets when a watcher links during the countdown', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 30,
		autoExit: true,
		watchFs: false,
		writeReport: false,
		idleExitGraceMs: 120,
	})
	try {
		// 首个非 watch viewer 离开 → 宽限计时开始。
		const first = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
		await new Promise((resolve, reject) => {
			first.addEventListener('open', resolve, { once: true })
			first.addEventListener('error', reject, { once: true })
		})
		first.send(JSON.stringify({ type: 'hello', watch: false }))
		await new Promise(resolve => setTimeout(resolve, 20))
		first.close()
		// 宽限期内接上 watcher → 重置计时并保持存活，超过原宽限期仍在。
		await new Promise(resolve => setTimeout(resolve, 40))
		const watcher = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
		await new Promise((resolve, reject) => {
			watcher.addEventListener('open', resolve, { once: true })
			watcher.addEventListener('error', reject, { once: true })
		})
		watcher.send(JSON.stringify({ type: 'hello', watch: true }))
		await new Promise(resolve => setTimeout(resolve, 250))
		assertEquals(handle.kernel.closed, false)
		watcher.close()
		// watcher 离开后计时重新开始，满后退出。
		await awaitWithTimeout(handle.closed, 'kernel did not exit after watcher left')
	}
	finally {
		if (!handle.kernel.closed) await handle.close()
	}
})

Deno.test('idle-exit grace resets when pending work arrives during the countdown', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 31,
		autoExit: true,
		watchFs: false,
		writeReport: false,
		idleExitGraceMs: 120,
		prepSettleMs: 60_000,
	})
	try {
		const first = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
		await new Promise((resolve, reject) => {
			first.addEventListener('open', resolve, { once: true })
			first.addEventListener('error', reject, { once: true })
		})
		first.send(JSON.stringify({ type: 'hello', watch: false }))
		await new Promise(resolve => setTimeout(resolve, 20))
		first.close()
		// 宽限期内文件命中（进入预备）→ 队列非全空 → 计时重置。
		await new Promise(resolve => setTimeout(resolve, 40))
		handle.kernel.queues.hitPrep('testkit:pending', 'fs_change')
		await new Promise(resolve => setTimeout(resolve, 250))
		assertEquals(handle.kernel.closed, false)
		// 清空预备后重新开始计时，满后退出。
		handle.kernel.queues.prep.delete('testkit:pending')
		handle.kernel.wake()
		await awaitWithTimeout(handle.closed, 'kernel did not exit after pending work cleared')
	}
	finally {
		if (!handle.kernel.closed) await handle.close()
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
			idleExitGraceMs: 120,
		})
		const socket = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
		await new Promise((resolve, reject) => {
			socket.addEventListener('open', resolve, { once: true })
			socket.addEventListener('error', reject, { once: true })
		})
		const accepted = new Promise(resolve => {
			socket.addEventListener('message', event => {
				const message = JSON.parse(String(event.data))
				if (message.type === 'accepted') resolve(message)
			})
		})
		socket.send(JSON.stringify({ type: 'hello', watch: false, job: {} }))
		const message = await accepted
		assertEquals(message.empty, true)
		assertEquals(message.runCount, 0)
		assertEquals(message.code, 0)
		assertEquals(message.error, null)
		await assertRejects(() => readFile(reportMarkdownPath(root), 'utf8'))
		socket.close()
		await awaitWithTimeout(handle.closed, 'kernel did not exit after idle-exit grace')
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

			const socket = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
			await new Promise((resolve, reject) => {
				socket.addEventListener('open', resolve, { once: true })
				socket.addEventListener('error', reject, { once: true })
			})
			/** @type {object[]} */
			const events = []
			const done = new Promise(resolve => {
				socket.addEventListener('message', event => {
					const message = JSON.parse(String(event.data))
					events.push(message)
					if (message.type === 'job-done') resolve()
				})
			})
			socket.send(JSON.stringify({ type: 'hello', watch: false, job: {} }))
			await done
			socket.close()

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

			// 剩余只随 schedule-update 提供：初始 ETA 覆盖两个 heavy 套件，结束时归零。
			const schedules = events.filter(message => message.type === 'schedule-update')
			assertEquals(schedules.length > 0, true)
			const initial = schedules[0]
			assertEquals(initial?.lastCompletionMs >= 10_000, true, `initial=${initial?.lastCompletionMs}`)
			const last = schedules.at(-1)
			assertEquals(last?.lastCompletionMs <= 1000, true, `last=${last?.lastCompletionMs}`)
			assertEquals(last?.lastCompletionMs < (initial?.lastCompletionMs ?? 0), true)

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
			const socket = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
			await new Promise((resolve, reject) => {
				socket.addEventListener('open', resolve, { once: true })
				socket.addEventListener('error', reject, { once: true })
			})
			/** @type {object[]} */
			const events = []
			const done = new Promise(resolve => {
				socket.addEventListener('message', event => {
					const message = JSON.parse(String(event.data))
					events.push(message)
					if (message.type === 'job-done') resolve()
				})
			})
			socket.send(JSON.stringify({
				type: 'hello',
				watch: false,
				job: {
					groups: [{
						manifestSelectors: ['testkit'],
						suiteSelectors: ['__wait_next__'],
						subtestSelectors: {},
					}],
				},
			}))
			await done
			socket.close()
			const accepted = events.find(message => message.type === 'accepted')
			assertEquals(accepted?.runCount, 1)
			const initial = events.find(message => message.type === 'schedule-update' && message.reason === 'initial')
			assertEquals(initial?.lastCompletionMs > 50_000, true, `lastCompletionMs=${initial?.lastCompletionMs}`)
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
	const root = join(tmpdir(), `fount-kernel-preempt-${Date.now()}`)
	await mkdir(root, { recursive: true })
	const manifestFilePath = join(root, 'src/parts/demo/test/manifest.json')
	try {
		const init = await execFile('git', ['init', '-b', 'main'], { cwd: root })
		assertEquals(init.code, 0)
		const commit = await execFile('git', [
			'-c', 'user.email=t@t', '-c', 'user.name=t',
			'commit', '--allow-empty', '-m', 'init',
		], { cwd: root })
		assertEquals(commit.code, 0)
		await mkdir(join(root, 'src/parts/demo/test'), { recursive: true })
		await writeFile(manifestFilePath, `${JSON.stringify({
			id: 'demo',
			suites: [{ name: 'pure', run: ['true'], triggers: ['src/parts/demo/**'] }],
		}, null, '\t')}\n`, 'utf8')

		const handle = await startTestKernel({
			port: CONTROL_PORT + 22,
			repoRoot: root,
			autoExit: false,
			watchFs: false,
			writeReport: false,
			autoUpdateExpected: false,
		})
		try {
			const kernel = handle.kernel
			const abort = new AbortController()
			kernel.running.set('demo:pure', {
				item: { key: 'demo:pure', reason: 'idle_all' },
				abort,
				startedAt: Date.now(),
				checkDone: true,
			})
			kernel.queues.enqueueFs('demo:pure', 'idle_all')
			kernel.queues.enqueueFs('demo:normal', 'fs_change')
			// 提交一个命不中任何 suite 的空 job（不激活波次）也会在开头触发抢占。
			/**
			 * 提交命不中任何 suite 的空 job。
			 * @returns {Promise<object>} submitted 结果
			 */
			const preemptJob = () => kernel.submitJob({
				groups: [{
					manifestSelectors: ['demo'],
					suiteSelectors: ['__no_such_suite__'],
					subtestSelectors: {},
				}],
			}, 'v-preempt')
			await preemptJob()
			assertEquals(kernel.queues.fs.map(item => item.key), ['demo:normal'])
			assertEquals(abort.signal.aborted, true)
			assertEquals(String(abort.signal.reason), 'new_job')
			// 清空 running/队列后，无 idle_all 可取消时不再误重置闲置计时。
			kernel.running.delete('demo:pure')
			kernel.queues.fs = []
			const before = kernel.lastIdleAt
			await preemptJob()
			assertEquals(kernel.lastIdleAt, before)
		}
		finally {
			handle.kernel.running.delete('demo:pure')
			await handle.close()
		}
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

Deno.test('viewer_gone 不写失败状态：fresh 保持未跑、已失败保持原样', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT,
		autoExit: false,
		watchFs: false,
		writeReport: false,
		autoUpdateExpected: false,
	})
	const kernel = handle.kernel
	/** @type {Array<{ job: object, end: () => object | null, key: string }>} */
	const cases = []
	try {
		for (const [name, seeded] of [['slowFresh', undefined], ['slowFailed', { status: 'failed', commitHash: 'seed', failedFiles: [] }]]) {
			const key = `testkit:${name}`
			const suite = {
				manifestId: 'testkit',
				name,
				run: ['node', '-e', 'setTimeout(() => {}, 60000)'],
				triggers: [],
				dependencies: [],
				heavy: false,
			}
			kernel.catalog.allSuites.push(suite)
			kernel.catalog.byKey.set(key, suite)
			if (seeded) kernel.state.suites[key] = seeded
			const entry = enqueueDummyJob(kernel, { key, jobId: `${name}-job` })
			cases.push({ ...entry, key })
		}
		kernel.wake()
		for (const { key } of cases)
			await waitUntil(() => kernel.running.has(key))
		// 给 runCommand 一点时间真正拉起子进程，越过启动窗口后再断开 viewer。
		await new Promise(resolve => setTimeout(resolve, 300))
		kernel.dropViewer('v')
		for (const { job, end, key } of cases) {
			await awaitJob(job, `job ${key} 未收尾`)
			const event = end()
			assertEquals(event?.passed, true)
			assertEquals(event?.reused, true)
		}
		// 被 viewer_gone 终止的项视为未运行：不写失败状态、不推进指纹。
		assertEquals(kernel.state.suites['testkit:slowFresh'], undefined)
		assertEquals(kernel.state.suites['testkit:slowFailed'], { status: 'failed', commitHash: 'seed', failedFiles: [] })
	}
	finally {
		await handle.close()
	}
})

Deno.test('viewer_gone 在 moduleCheck 租约等待中被断开：视为未运行而非失败', async () => {
	const handle = await startTestKernel({
		port: KERNEL_PORT + 23,
		autoExit: false,
		watchFs: false,
		writeReport: false,
		autoUpdateExpected: false,
	})
	const kernel = handle.kernel
	const key = 'testkit:waitingLease'
	/** @type {string | null} */
	let heldTicket = null
	try {
		// 预占 moduleCheck 租约，使后续 deno suite 在 acquire 处排队等待。
		heldTicket = await kernel.moduleCheck.acquire()
		const suite = {
			manifestId: 'testkit',
			name: 'waitingLease',
			run: ['deno', 'run', '--allow-scripts', '--allow-all', 'nope.mjs'],
			triggers: [],
			dependencies: [],
			heavy: false,
		}
		kernel.catalog.allSuites.push(suite)
		kernel.catalog.byKey.set(key, suite)
		const entry = enqueueDummyJob(kernel, { key, jobId: 'waitingLease-job' })
		kernel.wake()
		// 确认任务在 acquire 处排队（未真正拉起 deno 子进程）。
		await waitUntil(() => kernel.moduleCheck.waiting > 0)
		kernel.dropViewer('v')
		await awaitJob(entry.job, 'job waitingLease 未收尾')
		const event = entry.end()
		assertEquals(event?.passed, true)
		assertEquals(event?.reused, true)
		// 等待租约期间被断开 → 不写失败状态、不推进指纹。
		assertEquals(kernel.state.suites[key], undefined)
	}
	finally {
		if (heldTicket) kernel.moduleCheck.abandon(heldTicket)
		await handle.close()
	}
})

Deno.test('autoUpdateExpected false does not auto-rewrite manifest after run', async () => {
	const root = join(tmpdir(), `fount-kernel-no-autoupdate-${Date.now()}`)
	await mkdir(root, { recursive: true })
	const manifestFilePath = join(root, 'src/parts/demo/test/manifest.json')
	try {
		const init = await execFile('git', ['init', '-b', 'main'], { cwd: root })
		assertEquals(init.code, 0)
		const commit = await execFile('git', [
			'-c', 'user.email=t@t', '-c', 'user.name=t',
			'commit', '--allow-empty', '-m', 'init',
		], { cwd: root })
		assertEquals(commit.code, 0)
		await mkdir(join(root, 'src/parts/demo/test'), { recursive: true })
		await writeFile(manifestFilePath, `${JSON.stringify({
			id: 'demo',
			suites: [{ name: 'pure', run: ['deno', 'eval', ''], triggers: ['src/parts/demo/**'] }],
		}, null, '\t')}\n`, 'utf8')

		const handle = await startTestKernel({
			port: CONTROL_PORT + 30,
			repoRoot: root,
			autoExit: false,
			watchFs: false,
			writeReport: false,
			autoUpdateExpected: false,
		})
		try {
			assertEquals(handle.kernel.autoUpdateExpected, false)
			const kernel = handle.kernel
			kernel.queues.enqueueFs('demo:pure', 'fs_change')
			kernel.wake()
			await waitUntil(() => kernel.running.size === 0 && kernel.queues.allEmpty(), 10_000)

			const json = JSON.parse(await readFile(manifestFilePath, 'utf8'))
			const jsonSuite = json.suites.find(suite => suite.name === 'pure')
			assertEquals(jsonSuite.expected, undefined)
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
			const socket = new WebSocket(`${handle.url.replace(/^http/, 'ws')}/ws/viewer`)
			await new Promise((resolve, reject) => {
				socket.addEventListener('open', resolve, { once: true })
				socket.addEventListener('error', reject, { once: true })
			})
			const started = new Promise(resolve => {
				socket.addEventListener('message', event => {
					const message = JSON.parse(String(event.data))
					if (message.type === 'suite-start' && message.key === key) resolve()
				})
			})
			socket.send(JSON.stringify({ type: 'hello', watch: true }))
			await awaitWithTimeout(started, 'idle-all did not run its suite', 4000)
			socket.close()
		}
		finally {
			await handle.close()
		}
	}
	finally {
		await rm(root, { recursive: true, force: true })
	}
})

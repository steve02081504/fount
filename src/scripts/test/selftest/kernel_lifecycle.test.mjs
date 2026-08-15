/**
 * 内核单例、退出、空波次与依赖丢弃。
 */
/* global Deno */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { execFile } from 'npm:@steve02081504/exec'

import { reportJsonPath, reportMarkdownPath, triggeredReasonsMarkdownPath } from '../core/paths.mjs'
import { startTestHub, testHubUrl } from '../hub/index.mjs'
import { kernelHealthy, parseNetstatListenPid, rebootTestKernel, shutdownTestKernel } from '../kernel/ensure.mjs'
import { ignoreWatchPath } from '../kernel/runtime.mjs'
import { startTestKernel } from '../kernel/server.mjs'

import {
	awaitJob,
	awaitWithTimeout,
	dummySkipSuite,
	enqueueDummyJob,
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

Deno.test('rebootTestKernel starts a kernel when none is running', async () => {
	const port = CONTROL_PORT + 4
	assertEquals(await kernelHealthy(testHubUrl(port)), false)
	const url = await rebootTestKernel({ port })
	try {
		assertEquals(url, testHubUrl(port))
		assertEquals(await kernelHealthy(url), true)
	}
	finally {
		await shutdownTestKernel({ port })
	}
})

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
import { ignoreWatchPath } from '../kernel/runtime.mjs'
import { startTestKernel } from '../kernel/server.mjs'

import {
	awaitJob,
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

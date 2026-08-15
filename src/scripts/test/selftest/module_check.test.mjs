/**
 * 模组检查闸：ready 之前第二个 acquire 等待。
 */
/* global Deno */
import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

import { assertEquals, assertRejects } from 'jsr:@std/assert'

import { REPO_ROOT } from '../core/repo_root.mjs'
import { waitUntil } from '../core/wait.mjs'
import {
	abandonModuleCheckTicket,
	acquireModuleCheckTicket,
	MODULE_CHECK_PRELOAD,
	ModuleCheckMissedReadyError,
	signalModuleCheckReady,
	withDenoModuleCheckPreload,
	withModuleCheckTicket,
} from '../hub/clients/module_check.mjs'
import { ModuleCheckGate } from '../kernel/module_check.mjs'
import { startTestKernel } from '../kernel/server.mjs'

import { awaitWithTimeout, enqueueAndAwaitSkip } from './kernel_fixtures.mjs'

Deno.test('ModuleCheckGate second acquire waits until first ready', async () => {
	const gate = new ModuleCheckGate()
	const first = await gate.acquire()
	let secondTicket
	const second = gate.acquire().then(ticket => { secondTicket = ticket })
	await Promise.resolve()
	assertEquals(secondTicket, undefined)
	const duration = gate.ready(first)
	assertEquals(typeof duration, 'number')
	await second
	assertEquals(Boolean(secondTicket), true)
	gate.ready(secondTicket)
})

Deno.test('ModuleCheckGate abandon releases waiters without recording duration', async () => {
	const gate = new ModuleCheckGate()
	const first = await gate.acquire()
	let secondTicket
	const second = gate.acquire().then(ticket => { secondTicket = ticket })
	await Promise.resolve()
	assertEquals(gate.abandon(first), true)
	assertEquals(gate.meanDurationMs(), 0)
	await second
	assertEquals(Boolean(secondTicket), true)
	assertEquals(gate.abandon(secondTicket), true)
	assertEquals(gate.abandon(secondTicket), false)
})

Deno.test('ModuleCheckGate abandon after ready is false', async () => {
	const gate = new ModuleCheckGate()
	const ticket = await gate.acquire()
	gate.ready(ticket)
	assertEquals(gate.abandon(ticket), false)
})

Deno.test('ModuleCheckGate meanDurationMs averages recorded ready durations', async () => {
	const gate = new ModuleCheckGate()
	assertEquals(gate.meanDurationMs(), 0)
	const ticket = await gate.acquire()
	await new Promise(resolve => setTimeout(resolve, 20))
	gate.ready(ticket)
	assertEquals(gate.meanDurationMs() > 0, true)
})

Deno.test('ModuleCheckGate ignores mismatched ticket', async () => {
	const gate = new ModuleCheckGate()
	const ticket = await gate.acquire()
	assertEquals(gate.ready('nope'), null)
	assertEquals(gate.heldTicket, ticket)
	gate.ready(ticket)
})

Deno.test('ModuleCheckGate hold timeout releases waiters when holder never readies', async () => {
	const gate = new ModuleCheckGate({ holdTimeoutMs: 50 })
	const leaked = await gate.acquire()
	const next = await awaitWithTimeout(gate.acquire(), 'hold timeout did not release waiter', 1000)
	assertEquals(Boolean(next), true)
	assertEquals(next === leaked, false)
	assertEquals(gate.ready(leaked), null)
	assertEquals(typeof gate.ready(next), 'number')
})

Deno.test('ModuleCheckGate hold timeout keeps missed-ready after abandon is false', async () => {
	const gate = new ModuleCheckGate({ holdTimeoutMs: 50 })
	const leaked = await gate.acquire()
	const next = await awaitWithTimeout(gate.acquire(), 'hold timeout did not release waiter', 1000)
	assertEquals(gate.abandon(leaked), false)
	assertEquals(gate.consumeMissedReady(leaked), true)
	assertEquals(gate.consumeMissedReady(leaked), false)
	assertEquals(typeof gate.ready(next), 'number')
	assertEquals(gate.consumeMissedReady(next), false)
})

Deno.test('ModuleCheckGate aborted waiter does not steal the next ticket', async () => {
	const gate = new ModuleCheckGate()
	const first = await gate.acquire()
	const abort = new AbortController()
	let stolen
	const waiting = gate.acquire(abort.signal).then(ticket => { stolen = ticket })
	await Promise.resolve()
	abort.abort()
	await awaitWithTimeout(
		waiting.then(() => { throw new Error('aborted acquire should reject') }, () => {}),
		'aborted acquire did not reject',
	)
	assertEquals(stolen, undefined)
	gate.ready(first)
	const third = await awaitWithTimeout(gate.acquire(), 'acquire hung after aborted waiter')
	assertEquals(Boolean(third), true)
	assertEquals(stolen, undefined)
	gate.ready(third)
})

Deno.test('ModuleCheckGate already-aborted signal does not enqueue a waiter', async () => {
	const gate = new ModuleCheckGate()
	const first = await gate.acquire()
	const abort = new AbortController()
	abort.abort()
	await awaitWithTimeout(
		assertRejects(() => gate.acquire(abort.signal), DOMException),
		'already-aborted acquire did not reject',
	)
	gate.ready(first)
	const next = await awaitWithTimeout(gate.acquire(), 'acquire hung after aborted-signal enqueue')
	assertEquals(Boolean(next), true)
	gate.ready(next)
})

Deno.test('ModuleCheckGate close rejects waiters and drops the holder', async () => {
	const gate = new ModuleCheckGate()
	await gate.acquire()
	const pending = gate.acquire()
	gate.close()
	await assertRejects(() => pending, DOMException)
	assertEquals(gate.heldTicket, null)
})

Deno.test('withDenoModuleCheckPreload inserts after run/test', () => {
	const ticket = 't1'
	assertEquals(
		withDenoModuleCheckPreload(['deno', 'test', '--no-check', 'a.test.mjs'], ticket),
		['deno', 'test', `--preload=${MODULE_CHECK_PRELOAD}`, '--no-check', 'a.test.mjs'],
	)
	assertEquals(
		withDenoModuleCheckPreload(['run', '--allow-all', 'worker.mjs'], ticket),
		['run', `--preload=${MODULE_CHECK_PRELOAD}`, '--allow-all', 'worker.mjs'],
	)
	assertEquals(withDenoModuleCheckPreload(['deno', 'test', 'a.test.mjs'], null), ['deno', 'test', 'a.test.mjs'])
	assertEquals(withDenoModuleCheckPreload(['node', 'playwright'], ticket), ['node', 'playwright'])
	assertEquals(
		withDenoModuleCheckPreload(['deno', 'test', '--preload=other.mjs', 'a.test.mjs'], ticket),
		['deno', 'test', `--preload=${MODULE_CHECK_PRELOAD}`, '--preload=other.mjs', 'a.test.mjs'],
	)
	assertEquals(
		withDenoModuleCheckPreload(['deno', 'test', '--import=other.mjs', 'a.test.mjs'], ticket),
		['deno', 'test', `--preload=${MODULE_CHECK_PRELOAD}`, '--import=other.mjs', 'a.test.mjs'],
	)
	assertEquals(
		withDenoModuleCheckPreload(['deno', 'test', '--preload', 'other.mjs', 'a.test.mjs'], ticket),
		['deno', 'test', `--preload=${MODULE_CHECK_PRELOAD}`, '--preload', 'other.mjs', 'a.test.mjs'],
	)
	assertEquals(
		withDenoModuleCheckPreload(['deno', 'bench', '--import', 'other.mjs', 'a.js'], ticket),
		['deno', 'bench', `--preload=${MODULE_CHECK_PRELOAD}`, '--import', 'other.mjs', 'a.js'],
	)
})

/** 与 kernel_lifecycle / skip_because 错开端口。 */
const MODULE_CHECK_KERNEL_PORT = 18940

/**
 * @param {number} port 端口
 * @param {object} [extra] 传给 startTestKernel 的额外选项
 * @returns {Promise<{ url: string, kernel: object, close: () => Promise<void> }>} 句柄
 */
function startModuleCheckKernel(port, extra = {}) {
	return startTestKernel({
		port,
		autoExit: false,
		watchFs: false,
		writeReport: false,
		...extra,
	})
}

Deno.test('module-check HTTP: second acquire waits for ready', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT)
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
	}
	finally {
		await handle.close()
	}
})

Deno.test('module-check HTTP: abandon releases the waiter', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 1)
	try {
		const held = await acquireModuleCheckTicket()
		let unblocked
		const waiting = acquireModuleCheckTicket().then(ticket => { unblocked = ticket })
		await new Promise(resolve => setTimeout(resolve, 30))
		assertEquals(unblocked, undefined)
		assertEquals(await abandonModuleCheckTicket(held), true)
		await waiting
		assertEquals(Boolean(unblocked), true)
		assertEquals(await abandonModuleCheckTicket(unblocked), true)
	}
	finally {
		await handle.close()
	}
})

Deno.test('module-check HTTP: abandon after ready returns false', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 2)
	try {
		const afterReady = await acquireModuleCheckTicket()
		await signalModuleCheckReady(afterReady)
		assertEquals(await abandonModuleCheckTicket(afterReady), false)
	}
	finally {
		await handle.close()
	}
})

Deno.test('module-check HTTP: missed-ready is distinct from business errors', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 3)
	try {
		await assertRejects(() => withModuleCheckTicket(async () => {}), ModuleCheckMissedReadyError)
		try {
			await withModuleCheckTicket(async () => ({ code: 1, output: 'FAILED' }))
			throw new Error('expected throw')
		}
		catch (error) {
			assertEquals(error instanceof ModuleCheckMissedReadyError, true)
			assertEquals(error.result, { code: 1, output: 'FAILED' })
		}
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
	}
})

Deno.test('module-check preload releases before deno test body', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 4)
	const dir = await Deno.makeTempDir({ prefix: 'fount-mc-preload-' })
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
		const second = await awaitWithTimeout(acquireModuleCheckTicket(), 'second acquire hung')
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
	}
})

Deno.test('module-check missed ready fails the deno suite', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 5)
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

Deno.test('module-check hold timeout still records missed ready when the suite exits', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 8, { moduleCheckHoldTimeoutMs: 50 })
	try {
		const suite = {
			manifestId: 'testkit',
			name: '__hold_timeout_missed__',
			run: ['deno', 'eval', 'await new Promise(resolve => setTimeout(resolve, 200))'],
			triggers: [],
			dependencies: [],
			heavy: false,
		}
		const { end, job } = await enqueueAndAwaitSkip(handle.kernel, suite, 'hold-timeout-missed')
		assertEquals(end?.passed, false)
		assertEquals(end?.missedReady, true)
		assertEquals(job.exitCode, 1)
	}
	finally {
		await handle.close()
	}
})

Deno.test('module-check HTTP: holder that never readies does not block later acquires', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 6, { moduleCheckHoldTimeoutMs: 80 })
	try {
		const leaked = await acquireModuleCheckTicket()
		assertEquals(Boolean(leaked), true)
		const next = await awaitWithTimeout(acquireModuleCheckTicket(), 'leaked holder blocked acquire', 1000)
		assertEquals(Boolean(next), true)
		assertEquals(next === leaked, false)
		assertEquals(await abandonModuleCheckTicket(leaked), true)
		await signalModuleCheckReady(next)
	}
	finally {
		await handle.close()
	}
})

Deno.test('module-check HTTP: aborted waiter does not steal the next ticket', async () => {
	const handle = await startModuleCheckKernel(MODULE_CHECK_KERNEL_PORT + 7)
	try {
		const first = await acquireModuleCheckTicket()
		const abort = new AbortController()
		const pending = fetch(`${handle.url}/module-check/acquire`, { method: 'POST', signal: abort.signal })
		await waitUntil(() => handle.kernel.moduleCheck.waiting > 0, 2000, 10)
		abort.abort()
		await pending.catch(() => {})
		await signalModuleCheckReady(first)
		const third = await awaitWithTimeout(acquireModuleCheckTicket(), 'acquire hung after aborted waiter', 1000)
		assertEquals(Boolean(third), true)
		await signalModuleCheckReady(third)
	}
	finally {
		await handle.close()
	}
})


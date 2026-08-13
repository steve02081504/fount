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

import { enqueueAndAwaitSkip } from './kernel_fixtures.mjs'

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

Deno.test('module-check HTTP: second acquire waits for ready', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	const handle = await startTestKernel({
		port: MODULE_CHECK_KERNEL_PORT,
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

Deno.test('module-check preload releases before deno test body', async () => {
	const previous = process.env.FOUNT_TEST_HUB_URL
	const handle = await startTestKernel({
		port: MODULE_CHECK_KERNEL_PORT + 1,
		autoExit: false,
		watchFs: false,
		writeReport: false,
	})
	process.env.FOUNT_TEST_HUB_URL = handle.url
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

Deno.test('module-check missed ready fails the deno suite', async () => {
	const handle = await startTestKernel({
		port: MODULE_CHECK_KERNEL_PORT + 2,
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


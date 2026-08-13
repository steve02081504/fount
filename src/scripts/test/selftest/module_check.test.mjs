/**
 * 模组检查闸：ready 之前第二个 acquire 等待。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { MODULE_CHECK_PRELOAD, withDenoModuleCheckPreload } from '../hub/clients/module_check.mjs'
import { ModuleCheckGate } from '../kernel/module_check.mjs'

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
	assertEquals(gate.durations.length, 0)
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
	assertEquals(gate.durations.length, 1)
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
})

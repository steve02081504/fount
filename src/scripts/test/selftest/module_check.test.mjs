/**
 * 模组检查闸：ready 之前第二个 acquire 等待。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

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

Deno.test('ModuleCheckGate ignores mismatched ticket', async () => {
	const gate = new ModuleCheckGate()
	const ticket = await gate.acquire()
	assertEquals(gate.ready('nope'), null)
	assertEquals(gate.heldTicket, ticket)
	gate.ready(ticket)
})

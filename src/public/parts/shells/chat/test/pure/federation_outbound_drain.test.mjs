/**
 * 联邦出站队列纯单测：drain 在批次刷空后 resolve，用于关键事件发布后拆除槽前的等待。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { createFedOutQueue } from '../../src/chat/federation/outbound.mjs'

Deno.test('createFedOutQueue drains pending items before resolving', async () => {
	const queue = createFedOutQueue()
	const sent = []
	queue.enqueue(0, () => sent.push('a'))
	queue.enqueue(0, () => sent.push('b'))
	await queue.drain()
	assertEquals(sent, ['a', 'b'])
})

Deno.test('createFedOutQueue drains when enqueue arrives after a flush', async () => {
	const queue = createFedOutQueue()
	queue.enqueue(0, () => { })
	await queue.drain()
	queue.enqueue(0, () => { })
	await queue.drain()
	await queue.drain()
})

Deno.test('createFedOutQueue resolves drain immediately when idle', async () => {
	const queue = createFedOutQueue()
	await queue.drain()
})

/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	dispatchMailboxRecordsToConsumers,
	registerMailboxConsumer,
	unregisterMailboxConsumer,
} from '../mailbox/consumer_registry.mjs'

Deno.test('dispatchMailboxRecordsToConsumers merges consumer ids', async () => {
	const username = 'test-user'
	/** @type {string[]} */
	let seen = []
	registerMailboxConsumer('test/a', 'chat', async (username, records) => {
		seen = records.map(r => r.id)
		return ['a1']
	})
	registerMailboxConsumer('test/b', 'social', async () => ['b1'])
	const delivered = await dispatchMailboxRecordsToConsumers(username, [
		{ id: 'r1', app: 'chat', envelope: { type: 'message' } },
	])
	assertEquals(seen, ['r1'])
	assertEquals(new Set(delivered), new Set(['a1']))
	unregisterMailboxConsumer('test/a')
	unregisterMailboxConsumer('test/b')
})

/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	dispatchMailboxRecordsToConsumers,
	registerMailboxConsumer,
	unregisterMailboxConsumer,
} from '../mailbox/consumer_registry.mjs'
import { parseMailboxGive } from '../mailbox/parse.mjs'

const RECIPIENT = 'a'.repeat(64)

Deno.test('dispatchMailboxRecordsToConsumers routes records by app', async () => {
	const username = 'test-user'
	/** @type {string[]} */
	let seen = []
	registerMailboxConsumer('test/a', 'chat', async (username, records) => {
		seen = records.map(r => r.id)
		return ['a1']
	})
	registerMailboxConsumer('test/b', 'social', async () => ['b1'])
	try {
		const delivered = await dispatchMailboxRecordsToConsumers(username, [
			{ id: 'r1', app: 'chat', envelope: { type: 'message' } },
		])
		assertEquals(seen, ['r1'])
		assertEquals(new Set(delivered), new Set(['a1']))
	}
	finally {
		unregisterMailboxConsumer('test/a')
		unregisterMailboxConsumer('test/b')
	}
})

Deno.test('dispatchMailboxRecordsToConsumers merges consumer ids across apps', async () => {
	const username = 'test-user'
	registerMailboxConsumer('test/chat', 'chat', async (_username, records) => records.map(r => r.id))
	registerMailboxConsumer('test/social', 'social', async (_username, records) => records.map(r => `social:${r.id}`))
	try {
		const delivered = await dispatchMailboxRecordsToConsumers(username, [
			{ id: 'c1', app: 'chat', envelope: { type: 'message' } },
			{ id: 's1', app: 'social', envelope: { type: 'notify' } },
		])
		assertEquals(new Set(delivered), new Set(['c1', 'social:s1']))
	}
	finally {
		unregisterMailboxConsumer('test/chat')
		unregisterMailboxConsumer('test/social')
	}
})

Deno.test('parseMailboxGive rejects records without envelope or app', () => {
	assertEquals(parseMailboxGive({ records: [{ toPubKeyHash: RECIPIENT }] }), null)
	assertEquals(parseMailboxGive({
		records: [{
			toPubKeyHash: RECIPIENT,
			app: 'chat',
			envelope: { id: 'e1' },
		}],
	})?.records.length, 1)
})

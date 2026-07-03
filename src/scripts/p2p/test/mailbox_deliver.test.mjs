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
	/**
	 * 记录已处理记录。
	 * @type {string[]}
	 */
	let seen = []
	registerMailboxConsumer('chat', async (username, records) => {
		seen = records.map(r => r.id)
		return ['a1']
	})
	registerMailboxConsumer('social', async () => ['b1'])
	try {
		const delivered = await dispatchMailboxRecordsToConsumers(username, [
			{ id: 'r1', app: 'chat', envelope: { type: 'message' } },
		])
		assertEquals(seen, ['r1'])
		assertEquals(new Set(delivered), new Set(['a1']))
	}
	finally {
		unregisterMailboxConsumer('chat')
		unregisterMailboxConsumer('social')
	}
})

Deno.test('dispatchMailboxRecordsToConsumers merges consumer ids across apps', async () => {
	const username = 'test-user'
	registerMailboxConsumer('chat', async (_username, records) => records.map(r => r.id))
	registerMailboxConsumer('social', async (_username, records) => records.map(r => `social:${r.id}`))
	try {
		const delivered = await dispatchMailboxRecordsToConsumers(username, [
			{ id: 'c1', app: 'chat', envelope: { type: 'message' } },
			{ id: 's1', app: 'social', envelope: { type: 'notify' } },
		])
		assertEquals(new Set(delivered), new Set(['c1', 'social:s1']))
	}
	finally {
		unregisterMailboxConsumer('chat')
		unregisterMailboxConsumer('social')
	}
})

Deno.test('parseMailboxGive rejects records without envelope or app', () => {
	const missingEnvelope = parseMailboxGive({ records: [{ toPubKeyHash: RECIPIENT }] })
	assertEquals(missingEnvelope.ok, false)
	if (!missingEnvelope.ok)
		assertEquals(missingEnvelope.field, 'records[0].envelope')

	const valid = parseMailboxGive({
		records: [{
			toPubKeyHash: RECIPIENT,
			app: 'chat',
			envelope: { id: 'e1' },
		}],
	})
	assertEquals(valid.ok, true)
	if (valid.ok)
		assertEquals(valid.value.records.length, 1)
})

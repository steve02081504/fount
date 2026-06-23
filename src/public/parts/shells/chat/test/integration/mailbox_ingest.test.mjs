/**
 * mailbox/ingest 消费者单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/mailbox_ingest.test.mjs
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'mailbox-ingest-user',
	tempDirPrefix: 'fount_mailbox_ingest_',
	minP2pNode: true,
})

Deno.test('chat mailbox consumer skips records without envelope', async () => {
	await ensureServer()
	const { dispatchMailboxRecordsToConsumers } = await import('fount/scripts/p2p/mailbox/consumer_registry.mjs')
	const {
		registerChatMailboxConsumer,
		unregisterChatMailboxConsumer,
	} = await import('../../src/chat/mailbox/ingest.mjs')
	registerChatMailboxConsumer()
	const delivered = await dispatchMailboxRecordsToConsumers(username, [{
		id: 'rec-1',
		app: 'chat',
		groupId: 'g1',
		envelope: null,
	}])
	assertEquals(delivered.length, 0)
	unregisterChatMailboxConsumer()
})

Deno.test('chat mailbox consumer skips records without groupId', async () => {
	await ensureServer()
	const { dispatchMailboxRecordsToConsumers } = await import('fount/scripts/p2p/mailbox/consumer_registry.mjs')
	const {
		registerChatMailboxConsumer,
		unregisterChatMailboxConsumer,
	} = await import('../../src/chat/mailbox/ingest.mjs')
	registerChatMailboxConsumer()
	const delivered = await dispatchMailboxRecordsToConsumers(username, [{
		id: 'rec-2',
		app: 'chat',
		envelope: { id: 'ev-2', type: 'message', groupId: 'g1' },
	}])
	assertEquals(delivered.length, 0)
	unregisterChatMailboxConsumer()
})

Deno.test('chat mailbox ingestMailboxGive drops quarantine tier records', async () => {
	await ensureServer()
	const { ingestMailboxGive } = await import('fount/scripts/p2p/mailbox/deliver_or_store.mjs')
	const count = await ingestMailboxGive({ replicaUsername: username }, {
		records: [{
			id: 'rec-q',
			app: 'chat',
			groupId: 'g1',
			toPubKeyHash: 'a'.repeat(64),
			envelope: { id: 'ev-q', type: 'message', groupId: 'g1' },
			tier: 'quarantine',
		}],
	})
	assertEquals(count, 0)
})

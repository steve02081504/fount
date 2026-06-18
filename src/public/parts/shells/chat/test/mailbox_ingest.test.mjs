/**
 * mailbox/ingest 消费者单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/mailbox_ingest.test.mjs
 */
/* global Deno */
import fs, { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'fount_mailbox_ingest_'))
const USER = 'mailbox-ingest-user'

/**
 *
 */
function prepareDataDir() {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	fs.writeFileSync(`${DATA_DIR}/config.json`, JSON.stringify({
		port: 18935,
		data: {
			users: {
				[USER]: {
					username: USER,
					auth: { userId: 'm', password: 'm', loginAttempts: 0, lockedUntil: null, refreshTokens: [] },
					jobs: {}, locales: [], defaultParts: {}, timers: {},
				},
			},
			revokedTokens: {}, apiKeys: {},
		},
	}, null, '\t'))
}

let booted = false
/**
 *
 */
async function ensureServer() {
	if (booted) return
	prepareDataDir()
	set_start()
	const okay = await init({
		/**
		 *
		 */
		restartor: () => { throw new Error('restart') },
		data_path: DATA_DIR,
		starts: { Web: false, IPC: false, Tray: false, DiscordRPC: false, Base: false, P2P: false },
	})
	if (!okay) throw new Error('server init failed')
	const { initNode, isNodeInitialized } = await import('../../../../../scripts/p2p/node/instance.mjs')
	const { createFountEntityStore } = await import('../../../../../server/p2p_server/entity_store.mjs')
	if (!isNodeInitialized()) {
		const nodeDir = join(DATA_DIR, 'p2p', 'node')
		fs.mkdirSync(nodeDir, { recursive: true })
		initNode({ nodeDir, entityStore: createFountEntityStore() })
	}
	booted = true
}

Deno.test('chat mailbox consumer skips records without envelope', async () => {
	await ensureServer()
	const { dispatchMailboxRecordsToConsumers } = await import('../../../../../scripts/p2p/mailbox/consumer_registry.mjs')
	const {
		registerChatMailboxConsumer,
		unregisterChatMailboxConsumer,
	} = await import('../src/chat/mailbox/ingest.mjs')
	registerChatMailboxConsumer()
	const delivered = await dispatchMailboxRecordsToConsumers(USER, [{
		id: 'rec-1',
		app: 'chat',
		groupId: 'g1',
		envelope: null,
	}])
	assertEquals(delivered.length, 0)
	unregisterChatMailboxConsumer()
})

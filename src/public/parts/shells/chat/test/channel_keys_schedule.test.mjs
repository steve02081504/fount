/**
 * channel_keys/schedule 单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/channel_keys_schedule.test.mjs
 */
/* global Deno */
import fs, { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'fount_ck_schedule_'))
const USER = 'ck-schedule-user'

/**
 *
 */
function prepareDataDir() {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	fs.writeFileSync(`${DATA_DIR}/config.json`, JSON.stringify({
		port: 18936,
		data: {
			users: {
				[USER]: {
					username: USER,
					auth: { userId: 'c', password: 'c', loginAttempts: 0, lockedUntil: null, refreshTokens: [] },
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

Deno.test('appendChannelKeyRotate returns null for empty channelId', async () => {
	await ensureServer()
	const { appendChannelKeyRotate } = await import('../src/chat/channel_keys/schedule.mjs')
	const result = await appendChannelKeyRotate(USER, 'group', '')
	assertEquals(result, null)
})

Deno.test('ensureChannelKey no-ops for empty channelId', async () => {
	await ensureServer()
	const { ensureChannelKey } = await import('../src/chat/channel_keys/schedule.mjs')
	await ensureChannelKey(USER, 'group', '  ')
})

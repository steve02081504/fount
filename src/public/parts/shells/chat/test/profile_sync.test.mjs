/**
 * profile/syncFromPersona 单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/profile_sync.test.mjs
 */
/* global Deno */
import fs, { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { encodeEntityHash } from '../../../../../scripts/p2p/entity_id.mjs'
import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'fount_profile_sync_'))
const USER = 'profile-sync-user'

/**
 *
 */
function prepareDataDir() {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	fs.writeFileSync(`${DATA_DIR}/config.json`, JSON.stringify({
		port: 18934,
		data: {
			users: {
				[USER]: {
					username: USER,
					auth: { userId: 'p', password: 'p', loginAttempts: 0, lockedUntil: null, refreshTokens: [] },
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

Deno.test('syncEntityProfileFromPersona skips non-writable foreign entityHash', async () => {
	await ensureServer()
	const { isWritableLocalEntity } = await import('../src/chat/lib/replica.mjs')
	const foreign = encodeEntityHash('b'.repeat(64), 'c'.repeat(64))
	assertEquals(isWritableLocalEntity(foreign), false)
	const { syncEntityProfileFromPersona } = await import('../src/profile/syncFromPersona.mjs')
	await syncEntityProfileFromPersona(USER, 'missing-group')
})

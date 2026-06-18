/**
 * federation room handler / gossip / pending relay 单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/federation_room_handlers.test.mjs
 */
/* global Deno */
import fs, { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'
import {
	buildGossipForwardPlan,
	takeGossipRequestSlot,
	wantIdsLimitsFromSettings,
} from '../src/chat/federation/gossip.mjs'
import { flushPendingRelay, enqueuePendingRelay } from '../src/chat/federation/pendingRelay.mjs'
import { shouldPreferJoinSnapshot } from '../src/chat/federation/staleResync.mjs'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'fount_pending_relay_'))
const USER = 'pending-relay-user'

/**
 *
 */
function prepareDataDir() {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	fs.writeFileSync(`${DATA_DIR}/config.json`, JSON.stringify({
		port: 18933,
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
	await init({
		/**
		 *
		 */
		restartor: () => { throw new Error('restart') },
		data_path: DATA_DIR,
		starts: { Web: false, IPC: false, Tray: false, DiscordRPC: false, Base: false, P2P: false },
	})
	booted = true
}

Deno.test('wantIdsLimitsFromSettings derives batch from budget', () => {
	const limits = wantIdsLimitsFromSettings({ wantIdsBudget: 64 })
	assertEquals(limits.inMaxBatch, 64)
	assertEquals(limits.outMaxBatch, 64)
})

Deno.test('takeGossipRequestSlot dedupes repeated keys', () => {
	const key = 'peer:want:abc'
	assertEquals(takeGossipRequestSlot(key), true)
	assertEquals(takeGossipRequestSlot(key), false)
})

Deno.test('buildGossipForwardPlan decrements ttl', () => {
	const parsed = {
		wantIds: ['a'.repeat(64)],
		ttl: 3,
		requesterNodeHash: 'b'.repeat(64),
		archiveSummary: null,
		attestation: null,
	}
	const plan = buildGossipForwardPlan(parsed, { gossipTtl: 5 })
	assert(plan)
	assertEquals(plan.forwardPayload.ttl, 2)
})

Deno.test('buildGossipForwardPlan returns null when ttl exhausted', () => {
	const parsed = { wantIds: [], ttl: 0, requesterNodeHash: 'b'.repeat(64) }
	assertEquals(buildGossipForwardPlan(parsed, { gossipTtl: 2 }), null)
})

Deno.test('shouldPreferJoinSnapshot when tipsHash mismatch', () => {
	const local = 'a'.repeat(64)
	const remote = [{ tipsHash: 'b'.repeat(64) }]
	assert(shouldPreferJoinSnapshot(local, remote))
	assertEquals(shouldPreferJoinSnapshot(local, [{ tipsHash: local }]), false)
})

Deno.test('flushPendingRelay on empty file returns 0', async () => {
	await ensureServer()
	const n = await flushPendingRelay(USER, '__empty_group__', async () => {})
	assertEquals(n, 0)
})

Deno.test('enqueuePendingRelay skips payload without id', async () => {
	await enqueuePendingRelay('u', 'g', { type: 'message' })
})

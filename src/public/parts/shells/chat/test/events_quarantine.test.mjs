/**
 * events/quarantine 重放单测。
 * 复测：deno test --no-check --allow-all src/public/parts/shells/chat/test/events_quarantine.test.mjs
 */
/* global Deno */
import fs, { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { set_start } from '../../../../../server/base.mjs'
import { init } from '../../../../../server/server.mjs'
import {
	appendQuarantinedEvent,
	readQuarantineRows,
	replayQuarantinedEvents,
} from '../src/chat/events/quarantine.mjs'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'fount_q_'))
const USER = 'quarantine-user'

/**
 *
 */
function prepareDataDir() {
	fs.mkdirSync(DATA_DIR, { recursive: true })
	fs.writeFileSync(`${DATA_DIR}/config.json`, JSON.stringify({
		port: 18932,
		data: {
			users: {
				[USER]: {
					username: USER,
					auth: { userId: 'q', password: 'q', loginAttempts: 0, lockedUntil: null, refreshTokens: [] },
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

Deno.test('replayQuarantinedEvents on empty quarantine returns zero', async () => {
	await ensureServer()
	const result = await replayQuarantinedEvents(USER, 'empty-group', async () => 'ok')
	assertEquals(result, { released: 0, remaining: 0 })
})

Deno.test('appendQuarantinedEvent and replay releases ok status', async () => {
	await ensureServer()
	const groupId = 'g-quarantine'
	const ev = { id: 'd'.repeat(64), type: 'message', groupId, sender: 'e'.repeat(64) }
	await appendQuarantinedEvent(USER, groupId, ev, 'hlc_skew')
	const rows = await readQuarantineRows(USER, groupId)
	assertEquals(rows.length, 1)

	const replay = await replayQuarantinedEvents(USER, groupId, async () => 'ok')
	assertEquals(replay.released, 1)
	assertEquals(replay.remaining, 0)
})

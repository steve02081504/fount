/**
 * pending_ingest 磁盘队列集成单测。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	enqueuePendingIngest,
	MAX_PENDING_INGEST_ROWS,
	PENDING_INGEST_TTL_MS,
	readPendingIngestRows,
	replayPendingIngestEvents,
} from '../../src/chat/federation/pendingIngest.mjs'
import { pendingIngestPath } from '../../src/chat/lib/paths.mjs'
import { createIntegrationBoot } from '../harness.mjs'

const { ensureServer, username } = createIntegrationBoot({
	username: 'pending-ingest-user',
	tempDirPrefix: 'fount_pending_ingest_',
	loadParts: [],
})

/** @returns {import('../../src/chat/dag/remoteIngest.mjs').RemoteIngestResult} 模拟入库成功 */
const applied = () => ({ status: 'applied' })
/** @returns {import('../../src/chat/dag/remoteIngest.mjs').RemoteIngestResult} 模拟 ACL 未就绪，暂不入库 */
const pending = () => ({ status: 'pending' })

Deno.test('replayPendingIngestEvents on empty file returns zero', async () => {
	await ensureServer()
	const result = await replayPendingIngestEvents(username, '__empty_group__', async () => applied())
	assertEquals(result, { released: 0, remaining: 0 })
})

Deno.test('enqueuePendingIngest skips payload without id', async () => {
	await ensureServer()
	await enqueuePendingIngest(username, 'g', { type: 'message' })
	const rows = await readPendingIngestRows(username, 'g')
	assertEquals(rows.length, 0)
})

Deno.test('enqueuePendingIngest and replay releases applied status', async () => {
	await ensureServer()
	const groupId = 'g-pending-ingest'
	const ev = { id: 'e'.repeat(64), type: 'member_ban', groupId, sender: 'f'.repeat(64) }
	await enqueuePendingIngest(username, groupId, ev, 'federated event pending: no ACL snapshot')
	const rows = await readPendingIngestRows(username, groupId)
	assertEquals(rows.length, 1)
	assertEquals(rows[0].reason, 'federated event pending: no ACL snapshot')

	const replay = await replayPendingIngestEvents(username, groupId, async () => applied())
	assertEquals(replay.released, 1)
	assertEquals(replay.remaining, 0)
})

Deno.test('replayPendingIngestEvents keeps rows while tryIngest still pending', async () => {
	await ensureServer()
	const groupId = 'g-pending-still'
	const ev = { id: 'f'.repeat(64), type: 'member_ban', sender: 'a'.repeat(64) }
	await enqueuePendingIngest(username, groupId, ev, 'waiting for ACL')
	const replay = await replayPendingIngestEvents(username, groupId, async () => pending())
	assertEquals(replay, { released: 0, remaining: 1 })
	assertEquals((await readPendingIngestRows(username, groupId)).length, 1)
})

Deno.test('replayPendingIngestEvents releases after tryIngest succeeds on a later pass', async () => {
	await ensureServer()
	const groupId = 'g-pending-retry'
	const ev = { id: '0'.repeat(64), type: 'member_ban', sender: 'a'.repeat(64) }
	await enqueuePendingIngest(username, groupId, ev, 'retry')
	let attempts = 0
	/** @returns {Promise<import('../../src/chat/dag/remoteIngest.mjs').RemoteIngestResult>} 首次 pending，第二次 applied */
	const tryIngest = async () => {
		attempts++
		return attempts >= 2 ? applied() : pending()
	}
	assertEquals(await replayPendingIngestEvents(username, groupId, tryIngest), { released: 0, remaining: 1 })
	assertEquals(await replayPendingIngestEvents(username, groupId, tryIngest), { released: 1, remaining: 0 })
})

Deno.test('expired pending_ingest rows are dropped on read', async () => {
	await ensureServer()
	const groupId = 'g-pending-expired'
	const ev = { id: '1'.repeat(64), type: 'member_ban', sender: '2'.repeat(64) }
	await enqueuePendingIngest(username, groupId, ev, 'old')
	const path = pendingIngestPath(username, groupId)
	const { readFile, writeFile } = await import('node:fs/promises')
	const raw = await readFile(path, 'utf8')
	const row = JSON.parse(raw.trim())
	row.pendedAt = Date.now() - PENDING_INGEST_TTL_MS - 1000
	await writeFile(path, `${JSON.stringify(row)}\n`, 'utf8')
	const rows = await readPendingIngestRows(username, groupId)
	assertEquals(rows.length, 0)
})

Deno.test('pending_ingest capacity trims oldest rows', async () => {
	await ensureServer()
	const groupId = 'g-pending-cap'
	for (let index = 0; index < MAX_PENDING_INGEST_ROWS + 5; index++) {
		const id = String(index).padStart(64, '0')
		await enqueuePendingIngest(username, groupId, {
			id,
			type: 'member_ban',
			sender: 'a'.repeat(64),
		}, 'cap')
	}
	const rows = await readPendingIngestRows(username, groupId)
	assertEquals(rows.length, MAX_PENDING_INGEST_ROWS)
	assertEquals(rows[0].event.id, '5'.padStart(64, '0'))
})

/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	archiveAppendMonotonic,
	canonicalArchiveMonthLine,
	digestArchiveMonthBody,
	digestArchiveMonthSnapshots,
	extendRollingMonthDigest,
	pickArchiveMonthByReputation,
	syncArchivedEventIdsFromMonthBody,
} from '../src/chat/archive/monthDigest.mjs'

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

/** @returns {number} 测试用零分 */
function zeroPickScore() {
	return 0
}

/** @returns {number} 测试用正信誉 */
function positivePickScore() {
	return 1
}

/**
 * @param {string} body 月 JSONL 正文
 * @param {string} peerNodeHash peer
 * @returns {Promise<{ peerNodeHash: string, tmpPath: string, complete: boolean }>} 仲裁候选
 */
async function archiveMonthCandidate(body, peerNodeHash) {
	const dir = await Deno.makeTempDir({ prefix: 'fount-archive-' })
	const tmpPath = `${dir}/month.jsonl`
	await Deno.writeTextFile(tmpPath, body)
	return { peerNodeHash, tmpPath, complete: true }
}

Deno.test('digest includes display snapshot fields', () => {
	const base = {
		eventId: A,
		channelId: 'general',
		timestamp: 1,
		content: { type: 'text', content: 'a' },
	}
	const d1 = digestArchiveMonthBody(`${canonicalArchiveMonthLine({
		...base,
		display: { name: 'alice', avatar: null },
	})}\n`).digest
	const d2 = digestArchiveMonthBody(`${canonicalArchiveMonthLine({
		...base,
		display: { name: 'bob', avatar: null },
	})}\n`).digest
	assertEquals(d1.length, 64)
	assertEquals(d1 === d2, false)
})

Deno.test('digestArchiveMonthBody is stable for sorted snapshots', () => {
	const body = [
		canonicalArchiveMonthLine({
			eventId: B,
			channelId: 'general',
			timestamp: 2,
			content: { type: 'text', content: 'b' },
		}),
		canonicalArchiveMonthLine({
			eventId: A,
			channelId: 'general',
			timestamp: 1,
			content: { type: 'text', content: 'a' },
		}),
	].join('\n') + '\n'
	const d1 = digestArchiveMonthBody(body).digest
	const d2 = digestArchiveMonthBody(body).digest
	assertEquals(d1, d2)
	assertEquals(d1.length, 64)
})

Deno.test('syncArchivedEventIdsFromMonthBody registers event ids for month', () => {
	const manifest = { archivedEventIds: {} }
	const snaps = [{
		eventId: A,
		channelId: 'general',
		hlc: { wall: Date.UTC(2024, 0, 15) },
		content: {},
	}]
	const added = syncArchivedEventIdsFromMonthBody(manifest, 'general', '2024-01', snaps)
	assertEquals(added, 1)
	assertEquals(manifest.archivedEventIds.general[A], '2024-01')
	assertEquals(syncArchivedEventIdsFromMonthBody(manifest, 'general', '2024-01', snaps), 0)
})

Deno.test('pickArchiveMonthByReputation requires reputation or strict peer count', async () => {
	const manifest = { archivedEventIds: {}, monthDigests: {} }
	const body = canonicalArchiveMonthLine({
		eventId: A,
		channelId: 'general',
		timestamp: 1,
		content: { type: 'text', content: 'a' },
	}) + '\n'
	const weak = await pickArchiveMonthByReputation(
		[
			await archiveMonthCandidate(body, 'c'.repeat(64)),
			await archiveMonthCandidate(body, 'd'.repeat(64)),
		],
		manifest,
		'general',
		'2024-01',
		{ pickScore: zeroPickScore },
	)
	assertEquals(weak.reason, 'quorum_failed')

	const strong = await pickArchiveMonthByReputation(
		[
			await archiveMonthCandidate(body, 'c'.repeat(64)),
			await archiveMonthCandidate(body, 'd'.repeat(64)),
		],
		manifest,
		'general',
		'2024-01',
		{ pickScore: positivePickScore },
	)
	assertEquals(strong.reason, 'ok')
	assertEquals(strong.digest, digestArchiveMonthBody(body).digest)
})

Deno.test('extendRollingMonthDigest matches full digestArchiveMonthSnapshots', () => {
	const snaps = [
		{ eventId: A, channelId: 'general', timestamp: 1, content: { type: 'text', content: 'a' } },
		{ eventId: B, channelId: 'general', timestamp: 2, content: { type: 'text', content: 'b' } },
	]
	const full = digestArchiveMonthSnapshots(snaps).digest
	const rolling = extendRollingMonthDigest('', [snaps[0]])
	const rolling2 = extendRollingMonthDigest(rolling, [snaps[1]])
	assertEquals(rolling2, full)
})

Deno.test('archiveAppendMonotonic rejects out-of-order batch', () => {
	assertEquals(archiveAppendMonotonic(A, [{ eventId: B }]), true)
	assertEquals(archiveAppendMonotonic(B, [{ eventId: A }]), false)
	assertEquals(archiveAppendMonotonic('', [{ eventId: A }]), true)
})

Deno.test('pickArchiveMonthByReputation prefers manifest monthDigests on tie', async () => {
	const body = canonicalArchiveMonthLine({
		eventId: A,
		channelId: 'general',
		timestamp: 1,
		content: { type: 'text', content: 'a' },
	}) + '\n'
	const digest = digestArchiveMonthBody(body).digest
	const manifest = {
		archivedEventIds: {},
		monthDigests: { general: { '2024-01': digest } },
	}
	const picked = await pickArchiveMonthByReputation(
		[
			await archiveMonthCandidate(body, 'c'.repeat(64)),
			await archiveMonthCandidate(body, 'd'.repeat(64)),
		],
		manifest,
		'general',
		'2024-01',
		{ pickScore: zeroPickScore },
	)
	assertEquals(picked.reason, 'ok')
	assertEquals(picked.digest, digest)
})

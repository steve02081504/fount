/* global Deno */
import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { pubKeyHash, publicKeyFromSeed } from '../../crypto.mjs'
import { SOCIAL_TIMELINE_ROW_OPTS } from '../../dag/canonicalize_presets.mjs'
import { canonicalizeSignedRow } from '../../dag/canonicalizeRow.mjs'
import { encodeEntityHash } from '../../entity_id.mjs'
import { timelineGroupId } from '../../../../public/parts/shells/social/src/federation/namespace.mjs'
import { initTestP2pNode } from '../../test/helpers/node.mjs'
import { signTimelineEvent } from '../../timeline/append_core.mjs'
import { validateRemoteTimelineEvent } from '../../../../public/parts/shells/social/src/federation/remote_ingest.mjs'

/**
 * @param {object} event 签名事件
 * @returns {object} 规范化后的事件
 */
function canonicalizeTimelineRow(event) {
	return canonicalizeSignedRow(event, SOCIAL_TIMELINE_ROW_OPTS)
}

/**
 * @param {number} seedByte node.json 种子字节
 * @returns {Promise<string>} 临时 node 目录
 */
async function initTestNode(seedByte) {
	const dir = await mkdtemp(join(tmpdir(), 'fount-timeline-ingest-'))
	await mkdir(dir, { recursive: true })
	await writeFile(join(dir, 'node.json'), JSON.stringify({ nodeSeedHex: Buffer.alloc(32, seedByte).toString('hex') }))
	await writeFile(join(dir, 'denylist.json'), JSON.stringify({ blocked: [] }))
	initTestP2pNode({ nodeDir: dir })
	return dir
}

Deno.test('validateRemoteTimelineEvent rejects wrong groupId', async () => {
	const dir = await initTestNode(1)
	try {
		const owner = 'a'.repeat(64) + 'b'.repeat(64)
		const result = await validateRemoteTimelineEvent({
			type: 'post',
			groupId: 'social-timeline:' + 'c'.repeat(128),
			sender: 'd'.repeat(64),
			id: 'e'.repeat(64),
		}, owner, { canonicalize: canonicalizeTimelineRow })
		assertEquals(result.accepted, false)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('validateRemoteTimelineEvent rejects unknown event type', async () => {
	const dir = await initTestNode(2)
	try {
		const owner = 'a'.repeat(64) + 'b'.repeat(64)
		const result = await validateRemoteTimelineEvent({
			type: 'message',
			groupId: timelineGroupId(owner),
			sender: 'd'.repeat(64),
			id: 'e'.repeat(64),
		}, owner, { canonicalize: canonicalizeTimelineRow })
		assertEquals(result.accepted, false)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

Deno.test('validateRemoteTimelineEvent accepts signed owner post with production canonicalize', async () => {
	const dir = await initTestNode(9)
	try {
		const secretKey = Buffer.alloc(32, 9)
		const sender = pubKeyHash(publicKeyFromSeed(secretKey))
		const owner = encodeEntityHash('c'.repeat(64), sender)
		const event = await signTimelineEvent({
			type: 'post',
			groupId: timelineGroupId(owner),
			sender,
			timestamp: 1_700_000_000_000,
			hlc: { wall: 1_700_000_000_000, counter: 0, node: sender.slice(0, 8) },
			prev_event_ids: [],
			content: { text: 'hello', visibility: 'public' },
			node_id: 'remote-test',
		}, secretKey)
		const result = await validateRemoteTimelineEvent(event, owner, { canonicalize: canonicalizeTimelineRow })
		assertEquals(result.accepted, true)
		assertEquals(result.row.id, event.id)
		assertEquals(result.row.sender, sender)
	}
	finally {
		await rm(dir, { recursive: true, force: true })
	}
})

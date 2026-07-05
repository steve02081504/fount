/**
 * Mailbox 公平淘汰单元测试（Deno）。
 */
/* global Deno */

import { ms } from 'fount/scripts/ms.mjs'
import {
	MAX_BUCKET_ENTRIES,
	mailboxBucketKey,
	mailboxRecordBytes,
	pruneMailboxBuckets,
	pruneMailboxGlobalFair,
} from 'fount/scripts/p2p/mailbox_prune.mjs'
import { takeIncomingMailboxPutSlot } from 'fount/scripts/p2p/mailbox_rate.mjs'
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const RECIPIENT_A = 'a'.repeat(64)
const RECIPIENT_B = 'b'.repeat(64)
const SENDER_ATTACK = 'c'.repeat(64)

/**
 * 构造测试用 mailbox 记录。
 * @param {string} to 收件人
 * @param {string} from 发送方
 * @param {number} i 序号
 * @param {number} [payloadSize] envelope 填充大小
 * @returns {object} 合成记录
 */
function syntheticRecord(to, from, i, payloadSize = 64) {
	const envelope = { id: `${from.slice(0, 8)}-${i}`, sender: from, pad: 'x'.repeat(payloadSize) }
	return {
		id: `${to.slice(0, 8)}-${from.slice(0, 8)}-${i}`,
		toPubKeyHash: to,
		fromNodeHash: from,
		envelope,
		storedAt: i,
		expiresAt: Date.now() + ms('24h'),
		hop: 0,
	}
}

Deno.test('takeIncomingMailboxPutSlot rate limits per source node', () => {
	const from = 'attacker-node'
	let allowed = 0
	for (let i = 0; i < 25; i++)
		if (takeIncomingMailboxPutSlot(from, { maxPuts: 20, windowMs: ms('1m') })) allowed++
	assertEquals(allowed, 20)
})

Deno.test('mailboxBucketKey uses to and from', () => {
	const record = syntheticRecord(RECIPIENT_A, SENDER_ATTACK, 1)
	assertEquals(mailboxBucketKey(record), `${RECIPIENT_A}\0${SENDER_ATTACK}`)
})

Deno.test('pruneMailboxBuckets caps per sender bucket', () => {
	const rows = []
	for (let i = 0; i < MAX_BUCKET_ENTRIES + 5; i++)
		rows.push(syntheticRecord(RECIPIENT_A, SENDER_ATTACK, i))
	const pruned = pruneMailboxBuckets(rows)
	assertEquals(pruned.length, MAX_BUCKET_ENTRIES)
	assertEquals(pruned.every(r => r.toPubKeyHash === RECIPIENT_A), true)
})

Deno.test('pruneMailboxGlobalFair keeps other recipient when one bucket floods', () => {
	const flood = []
	for (let i = 0; i < MAX_BUCKET_ENTRIES; i++)
		flood.push(syntheticRecord(RECIPIENT_A, SENDER_ATTACK, i, 200_000))
	const victim = syntheticRecord(RECIPIENT_B, 'd'.repeat(64), 0, 64)
	const afterBuckets = pruneMailboxBuckets([...flood, victim])
	const kept = pruneMailboxGlobalFair(afterBuckets)
	assertEquals(kept.some(r => r.toPubKeyHash === RECIPIENT_B), true)
	const bytesA = kept
		.filter(r => r.toPubKeyHash === RECIPIENT_A)
		.reduce((s, r) => s + mailboxRecordBytes(r), 0)
	const bytesB = kept
		.filter(r => r.toPubKeyHash === RECIPIENT_B)
		.reduce((s, r) => s + mailboxRecordBytes(r), 0)
	assertEquals(bytesB > 0, true)
	assertEquals(bytesA <= MAX_BUCKET_ENTRIES * 256 * 1024, true)
})

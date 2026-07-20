/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { pickJoinSnapshotByReputation } from '../../src/chat/federation/pull/joinSnapshotPick.mjs'

const TIPS_A = 'a'.repeat(64)
const TIPS_B = 'b'.repeat(64)
const PEER_C = 'c'.repeat(64)
const PEER_D = 'd'.repeat(64)
const PEER_E = 'e'.repeat(64)

/**
 * 返回测试用零信誉分。
 * @returns {number} 测试用零信誉分
 */
function zeroPickScore() {
	return 0
}

/**
 * 构造 join snapshot 候选。
 * @param {string} tipsHash tips 摘要
 * @param {string} peerNodeHash peer
 * @returns {object} 候选
 */
function candidate(tipsHash, peerNodeHash) {
	return {
		peerNodeHash,
		bucketKey: `tips:${tipsHash}`,
		envelope: { requestId: 'r1', requesterNodeHash: 'f'.repeat(64) },
	}
}

Deno.test('pickJoinSnapshotByReputation accepts two-peer quorum on same tipsHash', async () => {
	const picked = await pickJoinSnapshotByReputation(
		[candidate(TIPS_A, PEER_C), candidate(TIPS_A, PEER_D)],
		{ pickScore: zeroPickScore },
	)
	assertEquals(picked.reason, 'ok')
	assertEquals(picked.bucketKey, `tips:${TIPS_A}`)
})

Deno.test('pickJoinSnapshotByReputation prefers higher reputation tips bucket', async () => {
	/** 按 peer 声誉打分的选取函数。
	 * @type {(peerNodeHash: string) => number} */
	const scoreOf = peerNodeHash => peerNodeHash === PEER_E ? 10 : 0
	const picked = await pickJoinSnapshotByReputation(
		[candidate(TIPS_A, PEER_C), candidate(TIPS_B, PEER_E)],
		{ pickScore: scoreOf },
	)
	assertEquals(picked.reason, 'ok')
	assertEquals(picked.bucketKey, `tips:${TIPS_B}`)
})

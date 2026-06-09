/**
 * 入群 checkpoint 多 peer 信誉仲裁（与冷归档月拉同构）。
 */
import { isHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { pickNodeScoreFromReputation } from '../../../../../../../../scripts/p2p/reputation_pick_score.mjs'
import { penalizeArchiveServeMismatch } from '../../../../../../../../scripts/p2p/reputation_user.mjs'
import { ARCHIVE_QUORUM_PEER_MIN } from '../../archive/monthDigest.mjs'
import { verifyRemoteCheckpoint } from '../../lib/checkpointVerifier.mjs'
import { federationNodeHash } from '../deps.mjs'
import { joinSnapshotQuorumSatisfied, tryFinishFederationCollect } from '../federationCollect.mjs'
import { unwrapPullEnvelopeForLocalMember } from '../pullEnvelope.mjs'

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} requestId 请求 id
 * @returns {string} 等待键
 */
export function joinSnapshotWaitKey(username, groupId, requestId) {
	return `${username}\0${groupId}\0${requestId}`
}

/** @type {Map<string, { candidates: object[], finish: (list: object[]) => void, expectedCount: number }>} */
export const pendingSnapshotPulls = new Map()

/**
 * @param {object} envelope HPKE 响应
 * @param {object | null} inner 解密 inner
 * @returns {string} 分桶键
 */
function snapshotBucketKey(envelope, inner) {
	const tips = String(inner?.checkpoint?.local_tips_hash || '').trim().toLowerCase()
	if (isHex64(tips)) return `tips:${tips}`
	const root = String(inner?.checkpoint?.epoch_root_hash || '').trim().toLowerCase()
	if (isHex64(root)) return `root:${root}`
	return ''
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} envelope 解析后的 HPKE envelope
 * @param {string} peerNodeHash 对端 nodeHash
 * @returns {Promise<void>}
 */
export async function noteJoinSnapshotResponse(username, groupId, envelope, peerNodeHash) {
	if (envelope.requesterNodeHash !== federationNodeHash(username)) return
	const pending = pendingSnapshotPulls.get(joinSnapshotWaitKey(username, groupId, envelope.requestId))
	if (!pending) return
	const inner = await unwrapPullEnvelopeForLocalMember(username, groupId, envelope)
	if (!inner?.checkpoint) return
	const bucketKey = snapshotBucketKey(envelope, inner)
	if (!bucketKey) return
	const checkpointResult = await verifyRemoteCheckpoint(inner.checkpoint)
	if (!checkpointResult.valid) return
	pending.candidates.push({
		peerNodeHash: String(peerNodeHash).trim(),
		envelope,
		inner,
		bucketKey,
		tipsHash: String(inner.checkpoint.local_tips_hash || '').trim().toLowerCase(),
		epochRootHash: String(inner.checkpoint.epoch_root_hash || '').trim().toLowerCase(),
		epochId: Number(inner.checkpoint.epoch_id) || 0,
	})
	tryFinishFederationCollect(pending, joinSnapshotQuorumSatisfied)
}

/**
 * @param {Array<object>} candidates 各 peer 应答
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {{ pickScore?: (username: string, peerNodeHash: string, groupId: string) => number }} [opts] 测试可注入信誉分
 * @returns {Promise<{ winner: object | null, bucketKey: string, reason: string }>} 仲裁结果
 */
export async function pickJoinSnapshotByReputation(candidates, username, groupId, opts = {}) {
	/** @type {object | undefined} */
	let reputationFile
	if (!opts.pickScore) {
		const { loadReputation } = await import('../../../../../../../../scripts/p2p/reputation_user.mjs')
		reputationFile = loadReputation(username)
	}
	/** @type {Map<string, { peers: string[], envelope: object }>} */
	const byBucket = new Map()
	for (const row of candidates) {
		const peer = String(row.peerNodeHash || '').trim()
		const key = String(row.bucketKey || '').trim()
		if (!peer || !key) continue
		const bucket = byBucket.get(key) || { peers: [], envelope: row.envelope }
		bucket.peers.push(peer)
		byBucket.set(key, bucket)
	}
	if (!byBucket.size) return { winner: null, bucketKey: '', reason: 'no_valid_candidate' }

	const ranked = [...byBucket.entries()].map(([bucketKey, bucket]) => ({
		bucketKey,
		score: bucket.peers.reduce((best, peer) => Math.max(
			best,
			opts.pickScore
				? opts.pickScore(username, peer, groupId)
				: pickNodeScoreFromReputation(reputationFile, peer, groupId),
		), 0),
		bucket,
	}))
	ranked.sort((left, right) => {
		if (right.score !== left.score) return right.score - left.score
		if (right.bucket.peers.length !== left.bucket.peers.length)
			return right.bucket.peers.length - left.bucket.peers.length
		return left.bucketKey.localeCompare(right.bucketKey, 'en')
	})

	const best = ranked[0]
	if (!(best.score > 0 || best.bucket.peers.length >= ARCHIVE_QUORUM_PEER_MIN))
		return { winner: null, bucketKey: '', reason: 'quorum_failed' }
	return { winner: best.bucket.envelope, bucketKey: best.bucketKey, reason: 'ok' }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {Array<object>} candidates 原始候选
 * @param {string} winnerBucketKey 赢家分桶键
 * @returns {void}
 */
export function penalizeJoinSnapshotMismatches(username, groupId, candidates, winnerBucketKey) {
	for (const row of candidates) {
		if (!row.peerNodeHash || row.bucketKey === winnerBucketKey) continue
		penalizeArchiveServeMismatch(username, groupId, row.peerNodeHash)
	}
}

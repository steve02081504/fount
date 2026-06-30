/**
 * 入群 checkpoint 多 peer 信誉仲裁（与冷归档月拉同构）。
 */
import archiveTunables from '../../../../../../../../scripts/p2p/archive.tunables.json' with { type: 'json' }
import { isHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { penalizeArchiveServeMismatch, loadReputation } from '../../../../../../../../scripts/p2p/reputation.mjs'
import { pickNodeScoreFromReputation } from '../../../../../../../../scripts/p2p/reputation_pick_score.mjs'
import { resolveArchiveQuorumPeerMin } from '../../../../../../../../scripts/p2p/tunables_resolve.mjs'
import { verifyRemoteCheckpoint } from '../../dag/checkpointPayload.mjs'
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
 * @param {{ pickScore?: (peerNodeHash: string) => number, allowSinglePeerBootstrap?: boolean, activeMemberCount?: number }} [opts] 测试可注入信誉分；allowSinglePeerBootstrap：本机尚无 checkpoint 的首次自举允许接受单个已验证快照（信任邀请者，见调用方）
 * @returns {{ winner: object | null, bucketKey: string, reason: string }} 仲裁结果
 */
export function pickJoinSnapshotByReputation(candidates, opts = {}) {
	/** @type {(peer: string) => number} */
	let scorePeer = opts.pickScore
	if (!scorePeer) {
		const rep = loadReputation()
		scorePeer = pickNodeScoreFromReputation.bind(null, rep)
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
		score: bucket.peers.reduce((best, peer) => Math.max(best, scorePeer(peer)), 0),
		bucket,
	}))
	ranked.sort((left, right) => {
		if (right.score !== left.score) return right.score - left.score
		if (right.bucket.peers.length !== left.bucket.peers.length)
			return right.bucket.peers.length - left.bucket.peers.length
		return left.bucketKey.localeCompare(right.bucketKey, 'en')
	})

	const best = ranked[0]
	if (opts.allowSinglePeerBootstrap)
		return { winner: best.bucket.envelope, bucketKey: best.bucketKey, reason: 'bootstrap' }
	const quorumN = Math.max(
		Number(opts.activeMemberCount) || 0,
		best.bucket.peers.length,
		candidates.length,
	)
	const peerMin = resolveArchiveQuorumPeerMin(quorumN, archiveTunables)
	if (!(best.score > 0 || best.bucket.peers.length >= peerMin))
		return { winner: null, bucketKey: '', reason: 'quorum_failed' }
	return { winner: best.bucket.envelope, bucketKey: best.bucketKey, reason: 'ok' }
}

/**
 * @param {Array<object>} candidates 原始候选
 * @param {string} winnerBucketKey 赢家分桶键
 * @returns {void}
 */
export function penalizeJoinSnapshotMismatches(candidates, winnerBucketKey) {
	for (const row of candidates) {
		if (!row.peerNodeHash || row.bucketKey === winnerBucketKey) continue
		penalizeArchiveServeMismatch(row.peerNodeHash)
	}
}

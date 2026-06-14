/**
 * 入群快照：checkpoint + ckg wire channelHistories + fileKeyWraps + channelKeyWraps。
 * archiveManifest 仅作月份 union hint；checkpoint 经多 peer 信誉仲裁后写入。
 */
import { randomUUID } from 'node:crypto'

import { isSignedBaseCheckpoint } from '../../../../../../../scripts/p2p/checkpoint.mjs'
import { loadArchiveManifest, wireArchiveManifestForFederation } from '../archive/index.mjs'
import { rebuildAndSaveCheckpoint } from '../dag/materialize.mjs'
import { listChannelMessages } from '../dag/queries.mjs'
import { pickFederationTargetPeerIds } from '../governance/peerPool.mjs'


import { wireArchiveSummary, loadLocalFederationArchive } from './archiveHandshake.mjs'
import { federationNodeHash, loadFederationGroupSettings, loadFederationMaterializedState, requireDagDeps } from './deps.mjs'
import { createFederationCollect } from './federationCollect.mjs'
import {
	joinSnapshotWaitKey,
	pendingSnapshotPulls,
	penalizeJoinSnapshotMismatches,
	pickJoinSnapshotByReputation,
} from './pull/joinSnapshotPick.mjs'
import { resolveMemberEdPubKeyHex, signPullAttestation, validatePullAttestationForGroup } from './pullAttestation.mjs'
import {
	applyPullInner,
	buildPullResponseEnvelope,
	unwrapPullEnvelopeForLocalMember,
} from './pullEnvelope.mjs'

/**
 *
 */
export { parseJoinSnapshotRequest, parseJoinSnapshotResponse } from './pull/wire.mjs'

/**
 * 入群快照响应中每频道附带的历史消息条数上限。
 */
export const JOIN_SNAPSHOT_PER_CHANNEL = 500
const SNAPSHOT_WAIT_MS = 8000
const SNAPSHOT_RETRY_MAX = 1

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} envelope 解析后的 HPKE envelope
 * @returns {Promise<{ applied: boolean, channels: number }>} 应用结果
 */
export async function applyJoinSnapshotResponse(username, groupId, envelope) {
	const nodeHash = federationNodeHash(username)
	if (envelope.requesterNodeHash !== nodeHash) return { applied: false, channels: 0 }
	const inner = await unwrapPullEnvelopeForLocalMember(username, groupId, envelope)
	if (!inner) return { applied: false, channels: 0 }
	await applyPullInner(username, groupId, inner, {
		allowCheckpoint: true,
		pullRequestId: envelope.requestId,
	})
	return {
		applied: true,
		channels: Object.keys(inner.channelHistories || {}).length,
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} request 解析后的请求
 * @param {string} peerId Trystero peer
 * @param {(payload: unknown, peerId: string) => void} sendResponse 发送响应
 * @param {(subject: string) => boolean} isBlockedPeer 节点/pubKeyHash 拉黑检查
 * @returns {Promise<void>} 无返回值
 */
export async function handleJoinSnapshotRequest(username, groupId, request, peerId, sendResponse, isBlockedPeer) {
	if (request.groupId !== groupId || !peerId) return
	const fedState = await loadFederationMaterializedState(username, groupId)
	if (!fedState) return
	if (!await validatePullAttestationForGroup(fedState, groupId, request.attestation)) return
	if (isBlockedPeer(request.requesterPubKeyHash)) return
	const recipientEdPubKeyHex = resolveMemberEdPubKeyHex(fedState, request.requesterPubKeyHash)
	if (!recipientEdPubKeyHex) return

	const { readJsonl } = requireDagDeps()
	const checkpoint = await rebuildAndSaveCheckpoint(username, groupId, { skipChannelGc: true })
	const channelHistories = {}
	for (const channelId of Object.keys(fedState.channels || {}))
		channelHistories[channelId] = await listChannelMessages(username, groupId, channelId, {
			limit: JOIN_SNAPSHOT_PER_CHANNEL,
			limitCap: JOIN_SNAPSHOT_PER_CHANNEL,
			decrypt: false,
		})

	const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
	const archiveManifest = wireArchiveManifestForFederation(await loadArchiveManifest(username, groupId))
	const envelope = await buildPullResponseEnvelope(username, groupId, {
		requestId: request.requestId,
		requesterNodeHash: request.requesterNodeHash,
		requesterPubKeyHash: request.requesterPubKeyHash,
		recipientEdPubKeyHex,
		checkpoint,
		archiveSummary: wireArchiveSummary(localArchive.summary),
		archiveManifest,
		channelHistories,
		includeFileKeyGrant: true,
		includeChannelKeyWraps: true,
	})
	sendResponse(envelope, peerId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} slot FederationSlot
 * @returns {Promise<{ applied: boolean, channels: number }>} 应用结果统计
 */
export async function requestJoinSnapshotFromPeers(username, groupId, slot) {
	const { readJsonl } = requireDagDeps()
	const nodeHash = federationNodeHash(username)
	const localArchive = await loadLocalFederationArchive(username, groupId, readJsonl)
	const groupSettings = await loadFederationGroupSettings(username, groupId)
	const roster = slot.getRoster()

	/**
	 * @returns {Promise<object | null>} 仲裁后的赢家 envelope 或 null
	 */
	const sendOnce = async () => {
		const requestId = randomUUID()
		const attestation = await signPullAttestation(username, groupId, { requestId })
		const request = {
			requestId,
			requesterNodeHash: nodeHash,
			requesterPubKeyHash: attestation.requesterPubKeyHash,
			groupId,
			tipsHash: localArchive.summary?.tipsHash || '',
			attestation,
		}
		const waitKey = joinSnapshotWaitKey(username, groupId, requestId)
		const targets = await pickFederationTargetPeerIds(username, groupId, roster, groupSettings, nodeHash)
		const { promise: collectPromise, pending } = createFederationCollect(
			SNAPSHOT_WAIT_MS,
			targets.length,
			() => pendingSnapshotPulls.delete(waitKey),
		)
		pendingSnapshotPulls.set(waitKey, pending)
		if (targets.length)
			for (const peerId of targets)
				slot.send('fed_join_snapshot_request', request, peerId)
		else
			slot.send('fed_join_snapshot_request', request, null)
		const candidates = await collectPromise
		if (!candidates.length) return null
		const picked = await pickJoinSnapshotByReputation(candidates, username, groupId, {
			allowSinglePeerBootstrap: !isSignedBaseCheckpoint(localArchive.checkpoint),
		})
		if (!picked.winner) return null
		penalizeJoinSnapshotMismatches(username, groupId, candidates, picked.bucketKey)
		return picked.winner
	}

	let envelope = await sendOnce()
	for (let attempt = 0; !envelope && attempt < SNAPSHOT_RETRY_MAX; attempt++)
		envelope = await sendOnce()
	if (!envelope) return { applied: false, channels: 0 }
	return await applyJoinSnapshotResponse(username, groupId, envelope)
}

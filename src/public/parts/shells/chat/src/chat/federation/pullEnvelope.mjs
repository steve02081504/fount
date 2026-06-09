/**
 * 联邦补拉 HPKE 响应构建与应用。
 */
import { writeJsonAtomicSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { extractInboundSignedEvent, isPlainObject } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import { mergeRemoteArchiveManifestHints } from '../archive/index.mjs'
import { encryptSignedEventForWire } from '../channel_keys/content.mjs'
import { getState } from '../dag/materialize.mjs'
import { mergeChannelHistories } from '../dag/queries.mjs'
import { applyFileKeyGrant, buildFileKeyGrant } from '../file_keys/historicalGrant.mjs'
import { verifyRemoteCheckpoint } from '../lib/checkpointVerifier.mjs'
import { snapshotPath } from '../lib/paths.mjs'
import { safeReadJson } from '../lib/utils.mjs'

import { requireDagDeps } from './deps.mjs'
import { wrapPullResponseInner, unwrapPullResponseEnvelope } from './pullResponse.mjs'

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {object} opts 响应参数
 * @param {string} opts.requestId 请求 ID
 * @param {string} opts.requesterNodeHash 请求方 nodeId
 * @param {string} opts.requesterPubKeyHash 请求方 pubKeyHash
 * @param {string} opts.recipientEdPubKeyHex 接收方 Ed25519 公钥 hex
 * @param {object[]} [opts.events] DAG 事件
 * @param {Record<string, object[]>} [opts.channelHistories] 频道历史
 * @param {object} [opts.checkpoint] checkpoint
 * @param {object} [opts.archiveSummary] 存档摘要
 * @param {object} [opts.archiveManifest] 冷归档 manifest 月份 hint
 * @param {boolean} [opts.includeFileKeyGrant] 是否附带群文件主密钥 grant
 * @param {boolean} [opts.includeChannelKeyWraps] 是否附带频道密钥 wrap
 * @returns {Promise<object>} HPKE envelope
 */
export async function buildPullResponseEnvelope(username, groupId, opts) {
	const {
		requestId,
		requesterNodeHash,
		requesterPubKeyHash,
		recipientEdPubKeyHex,
		events = [],
		channelHistories,
		checkpoint,
		archiveSummary,
		archiveManifest,
		includeFileKeyGrant = false,
		includeChannelKeyWraps = false,
	} = opts
	/** @type {Record<string, unknown>} */
	const inner = {}
	if (checkpoint) inner.checkpoint = checkpoint
	if (archiveSummary) inner.archiveSummary = archiveSummary
	if (archiveManifest) inner.archiveManifest = archiveManifest
	if (events.length)
		inner.events = await Promise.all(events.map(ev => encryptSignedEventForWire(username, groupId, ev)))
	if (channelHistories && isPlainObject(channelHistories)) {
		/** @type {Record<string, object[]>} */
		const wireHistories = {}
		for (const [channelId, rows] of Object.entries(channelHistories)) {
			if (!Array.isArray(rows)) continue
			wireHistories[channelId] = rows
		}
		if (Object.keys(wireHistories).length)
			inner.channelHistories = wireHistories
	}
	if (includeFileKeyGrant)
		inner.fileKeyWraps = await buildFileKeyGrant(username, groupId, recipientEdPubKeyHex)
	if (includeChannelKeyWraps) {
		const { collectChannelKeyWrapsForRecipient } = await import('../channel_keys/bootstrap.mjs')
		const wraps = await collectChannelKeyWrapsForRecipient(username, groupId, recipientEdPubKeyHex)
		if (Object.keys(wraps).length) inner.channelKeyWraps = wraps
	}
	const wrapped = wrapPullResponseInner(recipientEdPubKeyHex, inner)
	return {
		requestId,
		requesterPubKeyHash,
		requesterNodeHash,
		...wrapped,
	}
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {object} inner 解密后的 inner
 * @param {{ allowCheckpoint?: boolean, pullRequestId?: string }} [opts] checkpoint 应用选项
 * @returns {Promise<{ eventsApplied: number, historiesMerged: number }>} 应用统计
 */
export async function applyPullInner(username, groupId, inner, opts = {}) {
	if (!isPlainObject(inner)) return { eventsApplied: 0, historiesMerged: 0 }
	if (inner.fileKeyWraps)
		await applyFileKeyGrant(username, groupId, inner.fileKeyWraps)
	if (isPlainObject(inner.channelKeyWraps)) {
		const { applyChannelKeyWrapsFromPull } = await import('../channel_keys/store.mjs')
		const { resolveLocalEventSigner } = await import('../dag/localSigner.mjs')
		const { sender } = await resolveLocalEventSigner(username, groupId)
		await applyChannelKeyWrapsFromPull(username, groupId, inner.channelKeyWraps, sender)
	}
	if (isPlainObject(inner.archiveManifest))
		await mergeRemoteArchiveManifestHints(username, groupId, inner.archiveManifest)
	if (isPlainObject(inner.checkpoint) && opts.allowCheckpoint === true) {
		const pullRequestId = String(opts.pullRequestId || '').trim()
		if (pullRequestId) {
			const localCheckpoint = await safeReadJson(snapshotPath(username, groupId))
			const remoteEpoch = Number(inner.checkpoint.epoch_id) || 0
			const localEpoch = Number(localCheckpoint?.epoch_id) || 0
			const remoteTips = String(inner.checkpoint.local_tips_hash || '').trim().toLowerCase()
			const localTips = String(localCheckpoint?.local_tips_hash || '').trim().toLowerCase()
			const shouldApply = !localCheckpoint?.checkpoint_event_id
				|| remoteEpoch > localEpoch
				|| (remoteEpoch === localEpoch && remoteTips && remoteTips !== localTips)
			if (shouldApply) {
				const checkpointResult = await verifyRemoteCheckpoint(inner.checkpoint)
					.catch(() => ({ valid: false }))
				if (checkpointResult.valid) {
					await writeJsonAtomicSynced(snapshotPath(username, groupId), inner.checkpoint)
					await getState(username, groupId, { skipWalRepair: true })
				}
			}
		}
	}
	let eventsApplied = 0
	const { appendValidatedRemoteEvent } = requireDagDeps()
	if (Array.isArray(inner.events))
		for (const rawEvent of inner.events) {
			const signedEvent = extractInboundSignedEvent(rawEvent, groupId)
			if (!signedEvent) continue
			if (await appendValidatedRemoteEvent(username, groupId, signedEvent, { logFailures: false }) === 'ok')
				eventsApplied++
		}
	let historiesMerged = 0
	if (isPlainObject(inner.channelHistories))
		historiesMerged = await mergeChannelHistories(username, groupId, inner.channelHistories)
	return { eventsApplied, historiesMerged }
}

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {object} envelope HPKE envelope
 * @returns {Promise<object | null>} 解密后的 inner
 */
export async function unwrapPullEnvelopeForLocalMember(username, groupId, envelope) {
	const { resolveLocalEventSigner } = await import('../dag/localSigner.mjs')
	try {
		const { secretKey } = await resolveLocalEventSigner(username, groupId)
		return unwrapPullResponseEnvelope(envelope, secretKey)
	}
	catch {
		return null
	}
}

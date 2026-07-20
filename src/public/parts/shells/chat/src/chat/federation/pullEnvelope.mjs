/**
 * 联邦补拉 HPKE 响应构建与应用。
 */
import { writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { invalidateTopologicalOrderMemo } from 'npm:@steve02081504/fount-p2p/federation/topo_order_memo'
import { extractInboundSignedEvent, isPlainObject } from 'npm:@steve02081504/fount-p2p/wire/ingress'

import { mergeRemoteArchiveManifestHints } from '../archive/index.mjs'
import { verifyRemoteCheckpoint } from '../dag/checkpointPayload.mjs'
import { getState } from '../dag/materialize.mjs'
import { mergeChannelHistories } from '../dag/queries.mjs'
import { applyFileKeyGrant, buildFileKeyGrant } from '../file_keys/historicalGrant.mjs'
import { safeReadJson } from '../lib/fsSafe.mjs'
import { snapshotPath } from '../lib/paths.mjs'

import { requireDagDeps } from './dagDependencies.mjs'
import { wrapPullResponseInner, unwrapPullResponseEnvelope } from './pullResponse.mjs'

/**
 * @param {string} username 本地用户
 * @param {string} groupId 群 ID
 * @param {object} options 响应参数
 * @param {string} options.requestId 请求 ID
 * @param {string} options.requesterNodeHash 请求方 nodeId
 * @param {string} options.requesterPubKeyHash 请求方 pubKeyHash
 * @param {string} options.recipientEdPubKeyHex 接收方 Ed25519 公钥 hex
 * @param {object[]} [options.events] DAG 事件
 * @param {Record<string, object[]>} [options.channelHistories] 频道历史
 * @param {object} [options.checkpoint] checkpoint
 * @param {object} [options.archiveSummary] 存档摘要
 * @param {object} [options.archiveManifest] 冷归档 manifest 月份 hint
 * @param {boolean} [options.includeFileKeyGrant] 是否附带群文件主密钥 grant
 * @param {boolean} [options.includeChannelKeyWraps] 是否附带频道密钥 wrap
 * @param {object} [options.viewerState] 物化群状态，用于按接收方可见频道筛选密钥授予
 * @returns {Promise<object>} HPKE envelope
 */
export async function buildPullResponseEnvelope(username, groupId, options) {
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
		viewerState = null,
	} = options
	/** @type {Record<string, unknown>} */
	const inner = {}
	if (checkpoint) inner.checkpoint = checkpoint
	if (archiveSummary) inner.archiveSummary = archiveSummary
	if (archiveManifest) inner.archiveManifest = archiveManifest
	if (events.length)
		inner.events = events.map(ev => stripDagEventLocalExtensions(ev))
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
	if (includeChannelKeyWraps)
		try {
			const { collectChannelKeyWrapsForRecipient } = await import('../channel_keys/bootstrap.mjs')
			const wraps = await collectChannelKeyWrapsForRecipient(username, groupId, recipientEdPubKeyHex, requesterPubKeyHash, viewerState)
			if (Object.keys(wraps).length) inner.channelKeyWraps = wraps
		}
		catch (error) {
			console.error('buildPullResponseEnvelope: channel key grant failed', error)
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
 * @param {{ allowCheckpoint?: boolean, pullRequestId?: string }} [options] checkpoint 应用选项
 * @returns {Promise<{ checkpointApplied: boolean }>} checkpoint 是否成功落盘
 */
export async function applyPullInner(username, groupId, inner, options = {}) {
	if (!isPlainObject(inner)) return { checkpointApplied: false }
	let checkpointApplied = false
	if (inner.fileKeyWraps)
		await applyFileKeyGrant(username, groupId, inner.fileKeyWraps)
	if (isPlainObject(inner.archiveManifest))
		await mergeRemoteArchiveManifestHints(username, groupId, inner.archiveManifest)
	if (isPlainObject(inner.checkpoint) && options.allowCheckpoint === true) {
		const pullRequestId = String(options.pullRequestId || '').trim()
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
					.catch(error => ({ valid: false, reason: error?.message }))
				if (checkpointResult.valid) {
					await writeJsonAtomicSynced(snapshotPath(username, groupId), inner.checkpoint)
					invalidateTopologicalOrderMemo(`${username}:${groupId}`)
					await getState(username, groupId, { skipWalRepair: true })
					checkpointApplied = true
				}
			}
		}
	}
	const { appendValidatedRemoteEvent } = requireDagDeps()
	if (Array.isArray(inner.events))
		for (const rawEvent of inner.events) {
			const signedEvent = extractInboundSignedEvent(rawEvent, groupId)
			if (!signedEvent) continue
			await appendValidatedRemoteEvent(username, groupId, signedEvent, { logFailures: false, ingress: 'backfill' })
		}
	// 频道密钥导入放在状态引导之后，且不得让密钥失败回滚已完成的 checkpoint/事件落盘。
	if (isPlainObject(inner.channelKeyWraps))
		try {
			const { applyChannelKeyWrapsFromPull } = await import('../channel_keys/store.mjs')
			const { resolveLocalEventSigner } = await import('../dag/localSigner.mjs')
			const { sender } = await resolveLocalEventSigner(username, groupId)
			await applyChannelKeyWrapsFromPull(username, groupId, inner.channelKeyWraps, sender)
		}
		catch (error) {
			console.error('applyPullInner: channel key import failed', error)
		}
	if (isPlainObject(inner.channelHistories))
		await mergeChannelHistories(username, groupId, inner.channelHistories)
	return { checkpointApplied }
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

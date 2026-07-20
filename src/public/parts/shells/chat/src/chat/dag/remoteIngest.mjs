/**
 * 【文件】`dag/remoteIngest.mjs` — 联邦/远程 DAG 事件入库。
 */
import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { computeEventId } from 'npm:@steve02081504/fount-p2p/dag/index'
import { isSubjectBannedByState, isSubjectBlocked } from 'npm:@steve02081504/fount-p2p/node/denylist'
import { isPeerPoolKeyBlocked, loadPeerPoolView } from 'npm:@steve02081504/fount-p2p/node/network'
import { recordMessageRateViolation } from 'npm:@steve02081504/fount-p2p/node/reputation_store'
import { extractInboundSignedEvent } from 'npm:@steve02081504/fount-p2p/wire/ingress'

import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { assertFederatedCkgContent } from '../channel_keys/content.mjs'
import {
	classifyHlcSkewAction,
	resolveHlcMaxSkewMs,
} from '../events/hlcPolicy.mjs'
import { appendQuarantinedEvent, replayQuarantinedEvents } from '../events/quarantine.mjs'
import { canRelayFederatedEvent } from '../federation/acl.mjs'
import { publishSignedEventToFederation } from '../federation/index.mjs'
import { enqueuePendingIngest, replayPendingIngestEvents } from '../federation/pendingIngest.mjs'
import { ensureFederationRoom, invalidateFederationRoomCache } from '../federation/room.mjs'
import { shouldRebindFederationRoomForEvent } from '../federation/rosterChange.mjs'
import { hasSeenFederationEvent, markSeenFederationEvent } from '../federation/seen.mjs'
import { checkMessageRateLimit } from '../governance/messageRateLimit.mjs'

import { prepareInboundRemoteChatEvent } from './canonicalizeEvent.mjs'
import { commitSignedChatEvent } from './commitSignedEvent.mjs'
import { withGroupWriteLock } from './groupLock.mjs'
import { validateIngestAuthz } from './ingest.mjs'
import { getState } from './materialize.mjs'
import { unsignedEventFields, validateSignature } from './validator.mjs'

/** 联邦入站 world_state content 尺寸上限（本机写不受限）。 */
export const WORLD_STATE_CONTENT_MAX_BYTES = 64 * 1024

/**
 * @param {string} type 事件 type
 * @param {unknown} content 事件 content
 * @returns {void}
 */
function assertFederatedWorldStateContentSize(type, content) {
	if (type !== 'world_state') return
	const bytes = new TextEncoder().encode(JSON.stringify(content ?? {})).byteLength
	if (bytes > WORLD_STATE_CONTENT_MAX_BYTES)
		throw new Error(`world_state content exceeds ${WORLD_STATE_CONTENT_MAX_BYTES} bytes`)
}

/** @typedef {{ status: 'applied' | 'duplicate' | 'invalid' | 'quarantined' | 'pending', reason?: string }} RemoteIngestResult */

/** @type {Map<string, Promise<RemoteIngestResult>>} */
const ingestInflight = new Map()

/**
 * @param {'applied' | 'duplicate' | 'invalid' | 'quarantined' | 'pending'} status 入库状态
 * @param {string} [reason] 可选原因
 * @returns {RemoteIngestResult} 结构化入库结果
 */
function ingestResult(status, reason) {
	return reason ? { status, reason } : { status }
}

/**
 * 摄入被接受（含链上重复）：mailbox 可标记 delivered；duplicate 表示已见过或未追加新链节。
 * @param {RemoteIngestResult | undefined} result 入库结果
 * @returns {boolean} 是否视为摄入成功
 */
export function isRemoteIngestAccepted(result) {
	return result?.status === 'applied' || result?.status === 'duplicate'
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} eventId 事件 id
 * @param {RemoteIngestResult} result 入库结果
 * @param {boolean} skipSeenDedup 是否跳过 seen
 * @returns {RemoteIngestResult} 结构化入库结果 原样返回 result
 */
function finishIngestSeen(username, groupId, eventId, result, skipSeenDedup) {
	if (!skipSeenDedup)
		markSeenFederationEvent(username, groupId, eventId)
	return result
}

/**
 * 隔离区事件在本地成功落盘后重放（由 ingest 路径调用，避免 commit ↔ ingest 环依赖）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function releaseQuarantinedEvents(username, groupId) {
	await replayQuarantinedEvents(username, groupId, event =>
		appendValidatedRemoteEvent(username, groupId, event, {
			logFailures: false,
			skipQuarantineRelease: true,
			skipQuarantineAppend: true,
			skipPendingIngestAppend: true,
			skipSeenDedup: true,
			ingress: 'backfill',
		}),
	)
}

/**
 * pending 队列在本地成功落盘或拓扑就绪后重放。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function releasePendingIngestEvents(username, groupId) {
	await replayPendingIngestEvents(username, groupId, event =>
		appendValidatedRemoteEvent(username, groupId, event, {
			logFailures: false,
			skipQuarantineRelease: true,
			skipQuarantineAppend: true,
			skipPendingIngestAppend: true,
			skipSeenDedup: true,
			ingress: 'backfill',
		}),
	)
}

/**
 * 校验远程 DAG 事件并追加到本地 `events.jsonl`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} signPayload 完整签名事件
 * @param {{ logFailures?: boolean, skipQuarantineRelease?: boolean, skipQuarantineAppend?: boolean, skipPendingIngestAppend?: boolean, skipSeenDedup?: boolean, ingress?: 'live' | 'backfill' }} [options] 日志、隔离/入站暂缓重放与写入选项
 * @returns {Promise<RemoteIngestResult>} 写入结果；`applied` 为新链节落盘，`duplicate` 为已摄入
 */
export async function appendValidatedRemoteEvent(username, groupId, signPayload, options = {}) {
	if (!signPayload?.id) return ingestResult('invalid', 'missing_id')
	const eventId = signPayload.id
	if (!options.skipSeenDedup) {
		if (hasSeenFederationEvent(username, groupId, eventId)) return ingestResult('duplicate', 'seen')
		const inflightKey = `${username}\0${groupId}\0${eventId}`
		const inflight = ingestInflight.get(inflightKey)
		if (inflight) return inflight
		const task = appendValidatedRemoteEventImpl(username, groupId, signPayload, options).finally(() => {
			if (ingestInflight.get(inflightKey) === task) ingestInflight.delete(inflightKey)
		})
		ingestInflight.set(inflightKey, task)
		return task
	}
	return appendValidatedRemoteEventImpl(username, groupId, signPayload, options)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} signPayload 完整签名事件
 * @param {{ logFailures?: boolean, skipQuarantineRelease?: boolean, skipQuarantineAppend?: boolean, skipPendingIngestAppend?: boolean, skipSeenDedup?: boolean }} options 选项
 * @returns {Promise<RemoteIngestResult>} 写入结果
 */
async function appendValidatedRemoteEventImpl(username, groupId, signPayload, options) {
	const logFailures = options.logFailures !== false
	const eventId = signPayload.id
	/**
	 * @param {RemoteIngestResult} ingestOutcome 入库结果
	 * @returns {RemoteIngestResult} 结构化入库结果
	 */
	function finish(ingestOutcome) {
		return finishIngestSeen(username, groupId, eventId, ingestOutcome, options.skipSeenDedup)
	}

	let wirePayload
	try {
		wirePayload = prepareInboundRemoteChatEvent(signPayload)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (shape)', error)
		return finish(ingestResult('invalid', 'shape'))
	}

	const bodyForId = unsignedEventFields(wirePayload)
	if (computeEventId(bodyForId) !== wirePayload.id) {
		if (logFailures) {
			console.error('federation: drop remote event (id mismatch)')
			await debugLog('remote-ingest-invalid', { username, groupId, reason: 'id_mismatch', eventId: wirePayload.id }).catch(() => {})
		}
		return finish(ingestResult('invalid', 'id_mismatch'))
	}

	const { state } = await getState(username, groupId)
	try {
		await validateSignature(bodyForId, wirePayload, wirePayload, undefined, state)
	}
	catch (error) {
		if (logFailures) {
			console.error('federation: drop remote event (signature)', error)
			await debugLog('remote-ingest-invalid', { username, groupId, reason: 'signature', eventId: wirePayload.id, message: error?.message }).catch(() => {})
		}
		return finish(ingestResult('invalid', 'signature'))
	}

	const maxSkewMs = resolveHlcMaxSkewMs(state)
	const hlcAction = classifyHlcSkewAction(wirePayload, maxSkewMs, { source: 'federation' })
	if (hlcAction === 'reject') {
		if (logFailures) console.error('federation: drop remote event (HLC skew)', wirePayload.type)
		return finish(ingestResult('invalid', 'hlc_skew'))
	}

	const senderKey = wirePayload.sender.trim().toLowerCase()
	const homeNodeHash = state.members?.[senderKey]?.homeNodeHash?.trim().toLowerCase() || ''
	const subject = {
		pubKeyHash: senderKey,
		nodeHash: isHex64(homeNodeHash) ? homeNodeHash : undefined,
		entityHash: isHex64(homeNodeHash) ? `${homeNodeHash}${senderKey}` : undefined,
	}
	if (isSubjectBannedByState(state, subject) || isSubjectBlocked( subject)) {
		if (logFailures) console.error('federation: drop remote event (banned/blocked subject)')
		return finish(ingestResult('invalid', 'banned'))
	}
	const peers = loadPeerPoolView( groupId)
	if (isPeerPoolKeyBlocked(peers, senderKey)
		|| (subject.nodeHash && isPeerPoolKeyBlocked(peers, subject.nodeHash))
		|| (subject.entityHash && isPeerPoolKeyBlocked(peers, subject.entityHash))) {
		if (logFailures) console.error('federation: drop remote event (blocked peer)')
		return finish(ingestResult('invalid', 'blocked_peer'))
	}

	if (hlcAction === 'quarantine') {
		if (options.skipQuarantineAppend) return finish(ingestResult('quarantined', 'hlc_skew'))
		await withGroupWriteLock(username, groupId, async () => {
			await appendQuarantinedEvent(username, groupId, wirePayload, 'hlc_skew')
		})
		return finish(ingestResult('quarantined', 'hlc_skew'))
	}

	try {
		assertFederatedWorldStateContentSize(String(wirePayload.type), wirePayload.content)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (content too large)', error)
		return finish(ingestResult('invalid', 'content_too_large'))
	}

	try {
		assertFederatedCkgContent(String(wirePayload.type), wirePayload.content)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (GSH required)', error)
		return finish(ingestResult('invalid', 'gsh_required'))
	}

	if (wirePayload.type === 'message') {
		const rateCheck = await checkMessageRateLimit(username, groupId, state, wirePayload)
		if (!rateCheck.ok) {
			const remoteNode = String(wirePayload.node_id || '').trim()
			if (remoteNode)
				recordMessageRateViolation(remoteNode, rateCheck.excessRatio ?? 1)
			if (logFailures) console.error('federation: drop remote event (rate limit)')
			return finish(ingestResult('invalid', 'rate_limit'))
		}
	}

	try {
		await validateIngestAuthz(username, groupId, wirePayload, { source: 'federation', state })
	}
	catch (error) {
		if (error?.deferrable) {
			if (options.skipQuarantineAppend) return finish(ingestResult('quarantined', 'missing_target'))
			await withGroupWriteLock(username, groupId, async () => {
				await appendQuarantinedEvent(username, groupId, wirePayload, 'missing_target')
			})
			return finish(ingestResult('quarantined', 'missing_target'))
		}
		if (error?.pendable) {
			if (options.skipPendingIngestAppend) return finish(ingestResult('pending', error.message))
			await withGroupWriteLock(username, groupId, async () => {
				await enqueuePendingIngest(username, groupId, wirePayload, error.message)
			})
			return finish(ingestResult('pending', error.message))
		}
		if (logFailures) console.error('federation: drop remote event (ingest authz)', error)
		return finish(ingestResult('invalid', 'authz'))
	}

	if (await commitSignedChatEvent(username, groupId, wirePayload, { ingress: options.ingress }) === 'dup')
		return finish(ingestResult('duplicate', 'event_id'))
	if (!options.skipQuarantineRelease) {
		await releaseQuarantinedEvents(username, groupId)
		await releasePendingIngestEvents(username, groupId)
	}
	if (shouldRebindFederationRoomForEvent(wirePayload)) {
		invalidateFederationRoomCache(username, groupId)
		void ensureFederationRoom(username, groupId).catch(error => {
			console.error('federation: remote rebind after roster event failed', error)
		})
	}
	return finish(ingestResult('applied'))
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {unknown} payload 联邦载荷（完整签名事件）
 * @param {{ skipSeenDedup?: boolean, logFailures?: boolean }} [options] ingest 选项
 * @returns {Promise<RemoteIngestResult | undefined>} 写入结果；无法解析为 undefined
 */
export async function ingestRemoteEvent(username, groupId, payload, options = {}) {
	const signedEvent = extractInboundSignedEvent(payload, groupId)
	if (!signedEvent) return undefined
	return appendValidatedRemoteEvent(username, groupId, signedEvent, { logFailures: true, ...options })
}

/**
 * checkpoint 后刷出 `pending_relay`：在已有物化快照下重新过联邦 ACL 再中继。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} signPayload 签名事件
 * @returns {Promise<boolean>} 已中继则为 true
 */
export async function relayPendingFederatedEvent(username, groupId, signPayload) {
	const { state } = await getState(username, groupId)
	if (!await canRelayFederatedEvent(state, signPayload, { username })) return false
	await publishSignedEventToFederation(username, groupId, signPayload)
	return true
}

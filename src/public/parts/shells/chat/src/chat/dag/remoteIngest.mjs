/**
 * 【文件】`dag/remoteIngest.mjs` — 联邦/远程 DAG 事件入库。
 */
import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { isSubjectBannedByState, isSubjectBlocked } from '../../../../../../../scripts/p2p/denylist.mjs'
import { computeEventId } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { isPeerPoolKeyBlocked, loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { recordMessageRateViolation } from '../../../../../../../scripts/p2p/reputation.mjs'
import { extractInboundSignedEvent } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import { assertFederatedCkgContent } from '../channel_keys/content.mjs'
import {
	classifyHlcSkewAction,
	resolveHlcMaxSkewMs,
} from '../events/hlcPolicy.mjs'
import { appendQuarantinedEvent, replayQuarantinedEvents } from '../events/quarantine.mjs'
import { canRelayFederatedEvent } from '../federation/acl.mjs'
import { publishSignedEventToFederation } from '../federation/index.mjs'
import { enqueuePendingIngest, replayPendingIngestEvents } from '../federation/pendingIngest.mjs'
import { hasSeenFederationEvent, markSeenFederationEvent } from '../federation/seen.mjs'
import { checkMessageRateLimit } from '../governance/messageRateLimit.mjs'

import { prepareInboundRemoteChatEvent } from './canonicalizeEvent.mjs'
import { commitSignedChatEvent } from './commitSignedEvent.mjs'
import { withGroupWriteLock } from './groupLock.mjs'
import { validateIngestAuthz } from './ingest.mjs'
import { getState } from './materialize.mjs'
import { unsignedEventFields, validateSignature } from './validator.mjs'

/** @type {Map<string, Promise<'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'>>} */
const ingestInflight = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} eventId 事件 id
 * @param {'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'} result 入库结果
 * @param {boolean} skipSeenDedup 是否跳过 seen
 * @returns {'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'} 原样返回 result
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
		}),
	)
}

/**
 * pending_ingest 队列在本地成功落盘或拓扑就绪后重放。
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
		}),
	)
}

/**
 * 校验远程 DAG 事件并追加到本地 `events.jsonl`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} signPayload 完整签名事件
 * @param {{ logFailures?: boolean, skipQuarantineRelease?: boolean, skipQuarantineAppend?: boolean, skipPendingIngestAppend?: boolean, skipSeenDedup?: boolean }} [opts] 日志、隔离/入站暂缓重放与写入选项
 * @returns {Promise<'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'>} 写入结果
 */
export async function appendValidatedRemoteEvent(username, groupId, signPayload, opts = {}) {
	if (!signPayload?.id) return 'invalid'
	const eventId = signPayload.id
	if (!opts.skipSeenDedup) {
		if (hasSeenFederationEvent(username, groupId, eventId)) return 'dup'
		const inflightKey = `${username}\0${groupId}\0${eventId}`
		const inflight = ingestInflight.get(inflightKey)
		if (inflight) return inflight
		const task = appendValidatedRemoteEventImpl(username, groupId, signPayload, opts).finally(() => {
			if (ingestInflight.get(inflightKey) === task) ingestInflight.delete(inflightKey)
		})
		ingestInflight.set(inflightKey, task)
		return task
	}
	return appendValidatedRemoteEventImpl(username, groupId, signPayload, opts)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} signPayload 完整签名事件
 * @param {{ logFailures?: boolean, skipQuarantineRelease?: boolean, skipQuarantineAppend?: boolean, skipPendingIngestAppend?: boolean, skipSeenDedup?: boolean }} opts 选项
 * @returns {Promise<'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'>} 写入结果
 */
async function appendValidatedRemoteEventImpl(username, groupId, signPayload, opts) {
	const logFailures = opts.logFailures !== false
	const eventId = signPayload.id
	/**
	 * @param {'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'} ingestResult 入库结果
	 * @returns {'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest'} 原样返回
	 */
	function finish(ingestResult) {
		return finishIngestSeen(username, groupId, eventId, ingestResult, opts.skipSeenDedup)
	}

	let wirePayload
	try {
		wirePayload = prepareInboundRemoteChatEvent(signPayload)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (shape)', error)
		return finish('invalid')
	}

	const bodyForId = unsignedEventFields(wirePayload)
	if (computeEventId(bodyForId) !== wirePayload.id) {
		if (logFailures) {
			console.error('federation: drop remote event (id mismatch)')
			await debugLog('remote-ingest-invalid', { username, groupId, reason: 'id_mismatch', eventId: wirePayload.id }).catch(() => {})
		}
		return finish('invalid')
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
		return finish('invalid')
	}

	const maxSkewMs = resolveHlcMaxSkewMs(state)
	const hlcAction = classifyHlcSkewAction(wirePayload, maxSkewMs, { source: 'federation' })
	if (hlcAction === 'reject') {
		if (logFailures) console.error('federation: drop remote event (HLC skew)', wirePayload.type)
		return finish('invalid')
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
		return finish('invalid')
	}
	const peers = loadPeerPoolView( groupId)
	if (isPeerPoolKeyBlocked(peers, senderKey)
		|| (subject.nodeHash && isPeerPoolKeyBlocked(peers, subject.nodeHash))
		|| (subject.entityHash && isPeerPoolKeyBlocked(peers, subject.entityHash))) {
		if (logFailures) console.error('federation: drop remote event (blocked peer)')
		return finish('invalid')
	}

	if (hlcAction === 'quarantine') {
		if (opts.skipQuarantineAppend) return finish('quarantined')
		await withGroupWriteLock(username, groupId, async () => {
			await appendQuarantinedEvent(username, groupId, wirePayload, 'hlc_skew')
		})
		return finish('quarantined')
	}

	try {
		assertFederatedCkgContent(String(wirePayload.type), wirePayload.content)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (GSH required)', error)
		return finish('invalid')
	}

	if (wirePayload.type === 'message') {
		const rateCheck = await checkMessageRateLimit(username, groupId, state, wirePayload)
		if (!rateCheck.ok) {
			const remoteNode = String(wirePayload.node_id || '').trim()
			if (remoteNode)
				recordMessageRateViolation(remoteNode, rateCheck.excessRatio ?? 1)
			if (logFailures) console.error('federation: drop remote event (rate limit)')
			return finish('invalid')
		}
	}

	try {
		await validateIngestAuthz(username, groupId, wirePayload, { source: 'federation', state })
	}
	catch (error) {
		// 暂时性失败（引用的 target/父事件尚未到达）：隔离待补齐后由 releaseQuarantinedEvents 重放，而非永久 drop。
		if (error?.deferrable) {
			if (opts.skipQuarantineAppend) return finish('quarantined')
			await withGroupWriteLock(username, groupId, async () => {
				await appendQuarantinedEvent(username, groupId, wirePayload, 'missing_target')
			})
			return finish('quarantined')
		}
		if (error?.pendable) {
			if (opts.skipPendingIngestAppend) return finish('pending_ingest')
			await withGroupWriteLock(username, groupId, async () => {
				await enqueuePendingIngest(username, groupId, wirePayload, error.message)
			})
			return finish('pending_ingest')
		}
		if (logFailures) console.error('federation: drop remote event (ingest authz)', error)
		return finish('invalid')
	}

	if (await commitSignedChatEvent(username, groupId, wirePayload) === 'dup') return finish('dup')
	if (!opts.skipQuarantineRelease) {
		await releaseQuarantinedEvents(username, groupId)
		await releasePendingIngestEvents(username, groupId)
	}
	return finish('ok')
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {unknown} payload Trystero 载荷（完整签名事件）
 * @param {{ skipSeenDedup?: boolean, logFailures?: boolean }} [opts] ingest 选项
 * @returns {Promise<'ok' | 'dup' | 'invalid' | 'quarantined' | 'pending_ingest' | undefined>} 写入结果；无法解析为 undefined
 */
export async function ingestRemoteEvent(username, groupId, payload, opts = {}) {
	const signedEvent = extractInboundSignedEvent(payload, groupId)
	if (!signedEvent) return undefined
	return appendValidatedRemoteEvent(username, groupId, signedEvent, { logFailures: true, ...opts })
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
	if (!canRelayFederatedEvent(state, signPayload)) return false
	await publishSignedEventToFederation(username, groupId, signPayload)
	return true
}

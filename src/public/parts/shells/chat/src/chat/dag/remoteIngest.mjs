/**
 * 【文件】`dag/remoteIngest.mjs` — 联邦/远程 DAG 事件入库。
 */
import { debugLog } from '../../../../../../../scripts/debug_log.mjs'
import { isSubjectBannedByState, isSubjectBlocked } from '../../../../../../../scripts/p2p/blocklist.mjs'
import { computeEventId } from '../../../../../../../scripts/p2p/dag/index.mjs'
import { readJsonl } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'
import { isPeerPoolKeyBlocked, loadPeerPoolView } from '../../../../../../../scripts/p2p/network.mjs'
import { recordMessageRateViolation } from '../../../../../../../scripts/p2p/reputation_user.mjs'
import { extractInboundSignedEvent } from '../../../../../../../scripts/p2p/wire_ingress.mjs'
import { assertFederatedCkgContent } from '../channel_keys/content.mjs'
import {
	classifyHlcSkewAction,
	resolveHlcMaxSkewMs,
} from '../events/hlcPolicy.mjs'
import { appendQuarantinedEvent, replayQuarantinedEvents } from '../events/quarantine.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { canRelayFederatedEvent } from '../federation/acl.mjs'
import { publishSignedEventToFederation } from '../federation/index.mjs'
import { checkMessageRateLimit } from '../governance/messageRateLimit.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { prepareInboundRemoteChatEvent } from './canonicalizeEvent.mjs'
import { commitSignedChatEvent } from './commitSignedEvent.mjs'
import { withGroupWriteLock } from './groupLock.mjs'
import { validateIngestAuthz } from './ingest.mjs'
import { getState } from './materialize.mjs'
import { unsignedEventFields, validateSignature } from './validator.mjs'

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
		}),
	)
}

/**
 * 校验远程 DAG 事件并追加到本地 `events.jsonl`。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} signPayload 完整签名事件
 * @param {{ logFailures?: boolean, skipQuarantineRelease?: boolean, skipQuarantineAppend?: boolean }} [opts] 日志、隔离重放与隔离写入选项
 * @returns {Promise<'ok' | 'dup' | 'invalid' | 'quarantined'>} 写入结果
 */
export async function appendValidatedRemoteEvent(username, groupId, signPayload, opts = {}) {
	const logFailures = opts.logFailures !== false
	if (!signPayload?.id) return 'invalid'

	let wirePayload
	try {
		wirePayload = prepareInboundRemoteChatEvent(signPayload)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (shape)', error)
		return 'invalid'
	}

	const path = eventsPath(username, groupId)
	const idNorm = String(wirePayload.id).trim().toLowerCase()
	const previous = await readJsonl(path, { sanitize: sanitizeFederatedEvent })
	if (previous.some(existing => String(existing.id).trim().toLowerCase() === idNorm)) return 'dup'

	const bodyForId = unsignedEventFields(wirePayload)
	if (computeEventId(bodyForId) !== wirePayload.id) {
		if (logFailures) {
			console.error('federation: drop remote event (id mismatch)')
			await debugLog('remote-ingest-invalid', { username, groupId, reason: 'id_mismatch', eventId: wirePayload.id }).catch(() => {})
		}
		return 'invalid'
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
		return 'invalid'
	}

	const maxSkewMs = resolveHlcMaxSkewMs(state)
	const hlcAction = classifyHlcSkewAction(wirePayload, maxSkewMs, { source: 'federation' })
	if (hlcAction === 'reject') {
		if (logFailures) console.error('federation: drop remote event (HLC skew)', wirePayload.type)
		return 'invalid'
	}

	const senderKey = wirePayload.sender.trim().toLowerCase()
	const homeNodeHash = state.members?.[senderKey]?.homeNodeHash?.trim().toLowerCase() || ''
	const subject = {
		pubKeyHash: senderKey,
		nodeHash: isHex64(homeNodeHash) ? homeNodeHash : undefined,
		entityHash: isHex64(homeNodeHash) ? `${homeNodeHash}${senderKey}` : undefined,
	}
	if (isSubjectBannedByState(state, subject) || isSubjectBlocked(username, subject)) {
		if (logFailures) console.error('federation: drop remote event (banned/blocked subject)')
		return 'invalid'
	}
	const peers = loadPeerPoolView(username, groupId)
	if (isPeerPoolKeyBlocked(peers, senderKey)
		|| (subject.nodeHash && isPeerPoolKeyBlocked(peers, subject.nodeHash))
		|| (subject.entityHash && isPeerPoolKeyBlocked(peers, subject.entityHash))) {
		if (logFailures) console.error('federation: drop remote event (blocked peer)')
		return 'invalid'
	}

	if (hlcAction === 'quarantine') {
		if (opts.skipQuarantineAppend) return 'quarantined'
		await withGroupWriteLock(username, groupId, async () => {
			await appendQuarantinedEvent(username, groupId, wirePayload, 'hlc_skew')
		})
		return 'quarantined'
	}

	try {
		assertFederatedCkgContent(String(wirePayload.type), wirePayload.content)
	}
	catch (error) {
		if (logFailures) console.error('federation: drop remote event (GSH required)', error)
		return 'invalid'
	}

	if (wirePayload.type === 'message') {
		const rateCheck = await checkMessageRateLimit(username, groupId, state, wirePayload)
		if (!rateCheck.ok) {
			const remoteNode = String(wirePayload.node_id || '').trim()
			if (remoteNode)
				recordMessageRateViolation(username, groupId, remoteNode)
			if (logFailures) console.error('federation: drop remote event (rate limit)')
			return 'invalid'
		}
	}

	try {
		await validateIngestAuthz(username, groupId, wirePayload, { source: 'federation', state })
	}
	catch (error) {
		// 暂时性失败（引用的 target/父事件尚未到达）：隔离待补齐后由 releaseQuarantinedEvents 重放，而非永久 drop。
		if (error?.deferrable) {
			if (opts.skipQuarantineAppend) return 'quarantined'
			await withGroupWriteLock(username, groupId, async () => {
				await appendQuarantinedEvent(username, groupId, wirePayload, 'missing_target')
			})
			return 'quarantined'
		}
		if (logFailures) console.error('federation: drop remote event (ingest authz)', error)
		return 'invalid'
	}

	if (await commitSignedChatEvent(username, groupId, wirePayload) === 'dup') return 'dup'
	if (!opts.skipQuarantineRelease)
		await releaseQuarantinedEvents(username, groupId)
	return 'ok'
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {unknown} payload Trystero 载荷（完整签名事件）
 * @returns {Promise<'ok' | 'dup' | 'invalid' | 'quarantined' | undefined>} 写入结果；无法解析为 undefined
 */
export async function ingestRemoteEvent(username, groupId, payload) {
	const signedEvent = extractInboundSignedEvent(payload, groupId)
	if (!signedEvent) return undefined
	return appendValidatedRemoteEvent(username, groupId, signedEvent, { logFailures: true })
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

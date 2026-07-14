/**
 * Social 时间线实体写授权（含 social_meta 创世语义）。
 */
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import {
	activeSenderHashFromPubKeyHex,
	foldEntityKeyHistoryFromEvents as foldRotateRevokeHistory,
	isRecoverySender,
	isValidActiveSender,
	resolveActiveKeyAtGeneration,
	isActiveGenerationRevoked,
} from 'npm:@steve02081504/fount-p2p/federation/entity_key_chain'

/**
 * 折叠时间线事件中的 recovery 公钥与实体密钥链（含 social_meta）。
 * @param {object[]} events 时间线事件（拓扑序）
 * @returns {{ recoveryPubKeyHex: string | null, entityKeyHistory: import('npm:@steve02081504/fount-p2p/federation/entity_key_chain').EntityKeyHistoryEntry[] }}
 */
export function foldEntityKeyHistoryFromEvents(events) {
	let recoveryPubKeyHex = null
	for (const event of events || [])
		if (event.type === 'social_meta' && isHex64(normalizeHex64(event.content?.recoveryPubKeyHex || '')))
			recoveryPubKeyHex = normalizeHex64(event.content.recoveryPubKeyHex)

	const folded = foldRotateRevokeHistory(events)
	return {
		recoveryPubKeyHex: recoveryPubKeyHex ?? folded.recoveryPubKeyHex,
		entityKeyHistory: folded.entityKeyHistory,
	}
}

/**
 * @param {object} params 授权参数
 * @param {string} params.entityHash 时间线 owner
 * @param {string} params.sender 事件 sender pubKeyHash
 * @param {string} params.eventType 事件 type
 * @param {object} [params.eventContent] 事件 content
 * @param {string | null} params.recoveryPubKeyHex recovery 公钥
 * @param {import('npm:@steve02081504/fount-p2p/federation/entity_key_chain').EntityKeyHistoryEntry[]} params.entityKeyHistory 密钥历史
 * @returns {boolean} 是否授权写入
 */
export function isEntityTimelineWriteAuthorized({
	entityHash,
	sender,
	eventType,
	eventContent,
	recoveryPubKeyHex,
	entityKeyHistory,
}) {
	void entityHash
	const normalizedSender = normalizeHex64(sender)
	if (!isHex64(normalizedSender) || !recoveryPubKeyHex) return false

	if (eventType === 'entity_key_rotate') {
		const generation = Number(eventContent?.generation)
		if (generation === 0)
			return isRecoverySender(recoveryPubKeyHex, normalizedSender)
		const prevGen = Number(eventContent?.prevGeneration ?? generation - 1)
		const prevActive = resolveActiveKeyAtGeneration(entityKeyHistory, prevGen)
		if (!prevActive || isActiveGenerationRevoked(entityKeyHistory, prevGen)) return false
		return activeSenderHashFromPubKeyHex(prevActive) === normalizedSender
	}

	if (eventType === 'entity_key_revoke')
		return isRecoverySender(recoveryPubKeyHex, normalizedSender)

	if (eventType === 'social_meta')
		return isRecoverySender(recoveryPubKeyHex, normalizedSender)
			|| isValidActiveSender(entityKeyHistory, recoveryPubKeyHex, normalizedSender)

	return isValidActiveSender(entityKeyHistory, recoveryPubKeyHex, normalizedSender)
}

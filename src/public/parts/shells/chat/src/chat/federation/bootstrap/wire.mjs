/**
 * 联邦 MQTT bootstrap 线消息解析（入站）。
 */
import { isHex64, normalizeHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { isPlainObject } from '../../../../../../../../scripts/p2p/wire_ingress.mjs'

/**
 * @param {unknown} payload 载荷
 * @returns {{ requestId: string, nodeHash: string, groupId: string, requesterPubKeyHash: string, localTipsHash?: string } | null} 解析结果
 */
export function parseFedBootstrapRequest(payload) {
	if (!isPlainObject(payload)) return null
	const requestId = String(payload.requestId || '').trim()
	const nodeHash = String(payload.nodeHash || '').trim()
	const groupId = String(payload.groupId || '').trim()
	const requesterPubKeyHash = normalizeHex64(payload.requesterPubKeyHash)
	if (!requestId || !nodeHash || !groupId || !isHex64(requesterPubKeyHash)) return null
	return {
		requestId,
		nodeHash,
		groupId,
		requesterPubKeyHash,
		localTipsHash: String(payload.localTipsHash || '').trim() || undefined,
	}
}

/**
 * @param {unknown} payload 载荷
 * @returns {{ requestId: string, responderNodeHash: string, encryptedMqttSecret: object, settingsEventId?: string } | null} 解析结果
 */
export function parseFedBootstrapResponse(payload) {
	if (!isPlainObject(payload)) return null
	const requestId = String(payload.requestId || '').trim()
	const responderNodeHash = String(payload.responderNodeHash || '').trim()
	if (!requestId || !responderNodeHash || !isPlainObject(payload.encryptedMqttSecret)) return null
	return {
		requestId,
		responderNodeHash,
		encryptedMqttSecret: payload.encryptedMqttSecret,
		settingsEventId: String(payload.settingsEventId || '').trim() || undefined,
	}
}

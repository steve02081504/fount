/**
 * 联邦房间凭证 bootstrap 线消息解析（入站）。
 */
import { isHex64, normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { isPlainObject } from 'npm:@steve02081504/fount-p2p/core/object'

/**
 * @param {unknown} payload 载荷
 * @returns {{ requestId: string, nodeHash: string, groupId: string, requesterPubKeyHash: string, localTipsHash?: string } | null} 解析结果
 */
export function parseFedBootstrapRequest(payload) {
	if (!isPlainObject(payload)) return null
	const requestId = (payload.requestId || '')
	const nodeHash = (payload.nodeHash || '')
	const groupId = (payload.groupId || '')
	const requesterPubKeyHash = normalizeHex64(payload.requesterPubKeyHash)
	if (!requestId || !nodeHash || !groupId || !isHex64(requesterPubKeyHash)) return null
	return {
		requestId,
		nodeHash,
		groupId,
		requesterPubKeyHash,
		localTipsHash: (payload.localTipsHash || '') || undefined,
	}
}

/**
 * @param {unknown} payload 载荷
 * @returns {{ requestId: string, responderNodeHash: string, encryptedRoomSecret: object, settingsEventId?: string } | null} 解析结果
 */
export function parseFedBootstrapResponse(payload) {
	if (!isPlainObject(payload)) return null
	const requestId = (payload.requestId || '')
	const responderNodeHash = (payload.responderNodeHash || '')
	if (!requestId || !responderNodeHash || !isPlainObject(payload.encryptedRoomSecret)) return null
	return {
		requestId,
		responderNodeHash,
		encryptedRoomSecret: payload.encryptedRoomSecret,
		settingsEventId: (payload.settingsEventId || '') || undefined,
	}
}

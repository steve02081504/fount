/**
 * 联邦补拉 attestation / HPKE 响应 wire 解析（无 attestation/envelope 即丢弃）。
 */
import { isHex64, normalizeHex64 } from '../../../../../../../../scripts/p2p/hexIds.mjs'
import { isPlainObject } from '../../../../../../../../scripts/p2p/wire_ingress.mjs'
import { EVENT_ID_HEX } from '../registry.mjs'

/** @typedef {{ requesterPubKeyHash: string, groupId: string, requestId: string, timestamp: number, wantIds?: string[], signature: string }} PullAttestation */

const ENVELOPE_BLOB_MIN_LEN = 2

/**
 * @param {unknown} value 密文字段
 * @returns {boolean} 是否像合法 ECIES blob 段
 */
function isEnvelopeBlob(value) {
	return String(value ?? '').trim().length >= ENVELOPE_BLOB_MIN_LEN
}

/**
 * @param {unknown} attestation 载荷 attestation 字段
 * @returns {PullAttestation | null} 解析结果
 */
export function parsePullAttestation(attestation) {
	if (!isPlainObject(attestation)) return null
	const requesterPubKeyHash = normalizeHex64(attestation.requesterPubKeyHash)
	const groupId = String(attestation.groupId || '').trim()
	const requestId = String(attestation.requestId || '').trim()
	const timestamp = Number(attestation.timestamp)
	const signature = String(attestation.signature || '').trim()
	if (!isHex64(requesterPubKeyHash) || !groupId || !Number.isFinite(timestamp) || !signature)
		return null
	const wantIds = Array.isArray(attestation.wantIds)
		? [...new Set(attestation.wantIds.map(id => String(id).trim().toLowerCase()).filter(id => EVENT_ID_HEX.test(id)))]
		: undefined
	return {
		requesterPubKeyHash,
		groupId,
		requestId,
		timestamp,
		wantIds,
		signature,
	}
}

/**
 * @param {unknown} envelope 响应 envelope
 * @returns {{ requestId: string, requesterPubKeyHash: string, requesterNodeHash: string, ephemPub: string, iv: string, ciphertext: string, authTag: string } | null} 解析结果
 */
export function parsePullResponseEnvelope(envelope) {
	if (!isPlainObject(envelope)) return null
	const requestId = String(envelope.requestId || '').trim()
	const requesterPubKeyHash = normalizeHex64(envelope.requesterPubKeyHash)
	const requesterNodeHash = String(envelope.requesterNodeHash || '').trim()
	const ephemPub = String(envelope.ephemPub || '').trim()
	const iv = String(envelope.iv || '').trim()
	const ciphertext = String(envelope.ciphertext || '').trim()
	const authTag = String(envelope.authTag || '').trim()
	if (!requestId || !isHex64(requesterPubKeyHash) || !requesterNodeHash) return null
	if (!isEnvelopeBlob(ephemPub) || !isEnvelopeBlob(iv) || !isEnvelopeBlob(ciphertext) || !isEnvelopeBlob(authTag))
		return null
	return {
		requestId,
		requesterPubKeyHash,
		requesterNodeHash,
		ephemPub,
		iv,
		ciphertext,
		authTag,
	}
}

/**
 * @param {unknown} data 入群快照请求载荷
 * @returns {object | null} 解析结果
 */
export function parseJoinSnapshotRequest(data) {
	if (!isPlainObject(data)) return null
	const requestId = String(data.requestId || '').trim()
	const requesterNodeHash = String(data.requesterNodeHash || '').trim()
	const groupId = String(data.groupId || '').trim()
	const attestation = parsePullAttestation(data.attestation)
	if (!requestId || !requesterNodeHash || !groupId || !attestation) return null
	if (attestation.groupId !== groupId || attestation.requestId !== requestId) return null
	const tipsHash = String(data.tipsHash || '').trim()
	return {
		requestId,
		requesterNodeHash,
		requesterPubKeyHash: attestation.requesterPubKeyHash,
		groupId,
		tipsHash: tipsHash ? tipsHash.toLowerCase() : undefined,
		attestation,
	}
}

/**
 * @param {unknown} data 入群快照响应载荷
 * @returns {object | null} 解析结果
 */
export function parseJoinSnapshotResponse(data) {
	return parsePullResponseEnvelope(data)
}

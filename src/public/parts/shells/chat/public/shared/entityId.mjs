import { encodeEntityHash } from 'https://esm.sh/@steve02081504/fount-p2p/core/entity_id_parse'
import { isHex64, normalizeHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { sha256Hex } from './digest.mjs'
/**
 * @param {unknown} pubKeyHex 32 字节公钥 hex
 * @returns {Promise<string>} 64 位 subjectHash（pubKeyHash）
 */
export async function hashFromPubKeyHex(pubKeyHex) {
	const hex = normalizeHex64(pubKeyHex)
	if (!isHex64(hex)) throw new Error('invalid pubKeyHex')
	const bytes = new Uint8Array(32)
	for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	return sha256Hex(bytes.buffer)
}

/**
 *
 */
export { encodeEntityHash }

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} recoveryPubKeyHex 32 字节 recovery 公钥 hex
 * @returns {Promise<string>} entityHash
 */
export async function entityHashFromRecoveryPubKeyHex(nodeHash, recoveryPubKeyHex) {
	return encodeEntityHash(nodeHash, await hashFromPubKeyHex(recoveryPubKeyHex))
}

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} subjectHash 成员签名 pubKeyHash（64 hex）
 * @returns {string} entityHash
 */
export function entityHashFromSubjectHash(nodeHash, subjectHash) {
	return encodeEntityHash(nodeHash, subjectHash)
}

import { AGENT_SUBJECT_PREFIX } from './agentConstants.mjs'
import { encodeEntityHash } from '../../../../../../scripts/p2p/entity_id_parse.mjs'

import { sha256Hex, sha256TextHex } from './digest.mjs'
import { isHex64, normalizeHex64 } from './pubKeyHex.mjs'

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
 * @param {string} charPartPath 角色 part 路径，如 `chars/MyChar`
 * @returns {Promise<string>} 64 位 agent subjectHash
 */
export async function agentSubjectHash(charPartPath) {
	const slug = String(charPartPath || '').trim().replace(/^\/+/, '').replace(/\\/g, '/')
	return sha256TextHex(`${AGENT_SUBJECT_PREFIX}${slug}`)
}

export { encodeEntityHash }

/**
 * @param {string} nodeHash 节点 hash
 * @param {string} charPartPath 角色 part 路径
 * @returns {Promise<string>} agent entityHash
 */
export async function agentEntityHash(nodeHash, charPartPath) {
	return encodeEntityHash(nodeHash, await agentSubjectHash(charPartPath))
}

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} recoveryPubKeyHex 32 字节 recovery 公钥 hex
 * @returns {Promise<string>} user entityHash
 */
export async function userEntityHashFromRecoveryPubKeyHex(nodeHash, recoveryPubKeyHex) {
	return encodeEntityHash(nodeHash, await hashFromPubKeyHex(recoveryPubKeyHex))
}

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} subjectHash 成员签名 pubKeyHash（64 hex）
 * @returns {string} user entityHash
 */
export function userEntityHashFromSubjectHash(nodeHash, subjectHash) {
	return encodeEntityHash(nodeHash, subjectHash)
}

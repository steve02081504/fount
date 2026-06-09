/**
 * 【文件】public/src/lib/entityId.mjs
 * 【职责】由公钥或角色路径计算 entityHash（nodeHash+subjectHash 编码）。
 * 【原理】hashFromPubKeyHex、agentSubjectHash(charPartPath)、encodeEntityHash 组合 128 hex。
 * 【数据结构】AGENT_SUBJECT_PREFIX、charPartPath、pubKeyHex。
 * 【关联】entityHash.mjs、friendBinding.mjs；资料与 DM 身份。
 */
import { sha256Hex, sha256TextHex } from '/scripts/digest.mjs'

import { isHex64, normalizeHex64 } from './pubKeyHex.mjs'

const AGENT_SUBJECT_PREFIX = 'fount:chat:agent:'

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

/**
 * @param {string} nodeHash 所属节点（64 hex）
 * @param {string} subjectHash 主体 hash（64 hex）
 * @returns {string} 128 位 entityHash
 */
export function encodeEntityHash(nodeHash, subjectHash) {
	const node = normalizeHex64(nodeHash)
	const subject = normalizeHex64(subjectHash)
	if (!isHex64(node) || !isHex64(subject))
		throw new Error('invalid entity hash parts')
	return node + subject
}

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
 * @param {string} pubKeyHex 32 字节公钥 hex
 * @returns {Promise<string>} user entityHash
 */
export async function userEntityHashFromPubKeyHex(nodeHash, pubKeyHex) {
	return encodeEntityHash(nodeHash, await hashFromPubKeyHex(pubKeyHex))
}

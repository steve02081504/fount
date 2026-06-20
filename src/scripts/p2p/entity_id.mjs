import { Buffer } from 'node:buffer'

import { pubKeyHash, sha256TextHex } from './crypto.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'

/** 128 位小写 hex：`nodeHash(64)` + `subjectHash(64)`。 */
export const ENTITY_HASH_RE = /^[\da-f]{128}$/u

const AGENT_SUBJECT_PREFIX = 'fount:chat:agent:'

/**
 * @param {unknown} pubKeyHex 32 字节公钥 hex
 * @returns {string} 64 位 nodeHash / subjectHash（pubKeyHash）
 */
export function hashFromPubKeyHex(pubKeyHex) {
	const hex = normalizeHex64(pubKeyHex)
	if (!isHex64(hex) || Buffer.from(hex, 'hex').length !== 32)
		throw new Error('invalid pubKeyHex')
	return pubKeyHash(Buffer.from(hex, 'hex'))
}

/**
 * @param {string} charPartPath 角色 part 路径，如 `chars/MyChar`
 * @returns {string} 64 位 agent subjectHash
 */
export function agentSubjectHash(charPartPath) {
	const slug = String(charPartPath || '').trim().replace(/^\/+/, '').replace(/\\/g, '/')
	return sha256TextHex(`${AGENT_SUBJECT_PREFIX}${slug}`)
}

/**
 * @param {string} nodeHash 所属节点（64 hex）
 * @param {string} subjectHash 主体（用户签名公钥 hash 或 agent subjectHash）
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
 * @param {unknown} entityHash 128 位 entityHash
 * @returns {{ entityHash: string, nodeHash: string, subjectHash: string } | null} 解析结果
 */
export function parseEntityHash(entityHash) {
	const raw = String(entityHash ?? '').trim().toLowerCase().replace(/^0x/iu, '')
	if (!ENTITY_HASH_RE.test(raw)) return null
	return {
		entityHash: raw,
		nodeHash: raw.slice(0, 64),
		subjectHash: raw.slice(64, 128),
	}
}

/**
 * @param {unknown} value 待校验值
 * @returns {boolean} 是否为合法 entityHash
 */
export function isEntityHash128(value) {
	return ENTITY_HASH_RE.test(String(value ?? '').trim().toLowerCase().replace(/^0x/iu, ''))
}

/**
 * @param {string} nodeHash 节点 hash
 * @param {string} charPartPath 角色 part 路径
 * @returns {string} agent entityHash
 */
export function agentEntityHash(nodeHash, charPartPath) {
	return encodeEntityHash(nodeHash, agentSubjectHash(charPartPath))
}

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} pubKeyHex 32 字节公钥 hex（legacy：活跃钥；新部署请用 recovery）
 * @returns {string} user entityHash
 */
export function userEntityHashFromPubKeyHex(nodeHash, pubKeyHex) {
	return encodeEntityHash(nodeHash, hashFromPubKeyHex(pubKeyHex))
}

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} recoveryPubKeyHex 32 字节 recovery 公钥 hex（稳定身份锚）
 * @returns {string} user entityHash
 */
export function userEntityHashFromRecoveryPubKeyHex(nodeHash, recoveryPubKeyHex) {
	return encodeEntityHash(nodeHash, hashFromPubKeyHex(recoveryPubKeyHex))
}

/**
 * @param {string} nodeHash 成员所属节点 hash
 * @param {string} subjectHash 成员签名 pubKeyHash（DAG sender）
 * @returns {string} user entityHash
 */
export function userEntityHashFromSubjectHash(nodeHash, subjectHash) {
	const node = normalizeHex64(nodeHash)
	const subject = normalizeHex64(subjectHash)
	if (!isHex64(node) || !isHex64(subject)) throw new Error('invalid subject hash')
	return encodeEntityHash(node, subject)
}

/**
 * @param {object} member 物化成员行
 * @param {string} [member.pubKeyHash] 用户成员签名公钥 hash
 * @param {string} [member.agentEntityHash] agent 成员 entityHash
 * @param {string} [member.homeNodeHash] 所属节点 hash
 * @param {string} [member.memberKind] user | agent
 * @returns {string | null} entityHash；无法派生时为 null
 */
export function memberEntityHash(member) {
	if (member?.memberKind === 'agent') {
		const agentEntityHash = String(member.agentEntityHash || '').trim().toLowerCase()
		return isEntityHash128(agentEntityHash) ? agentEntityHash : null
	}
	const subject = normalizeHex64(member?.pubKeyHash || '')
	const node = normalizeHex64(member?.homeNodeHash || '')
	if (!isHex64(subject) || !isHex64(node)) return null
	return encodeEntityHash(node, subject)
}

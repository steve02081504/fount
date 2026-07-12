import { Buffer } from 'node:buffer'

import { pubKeyHash } from './crypto.mjs'
import {
	encodeEntityHash,
	ENTITY_HASH_RE,
	isEntityHash128,
	parseEntityHash,
} from './entity_id_parse.mjs'
import { isHex64, normalizeHex64 } from './hexIds.mjs'

export {
	encodeEntityHash,
	ENTITY_HASH_RE,
	isEntityHash128,
	parseEntityHash,
}

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

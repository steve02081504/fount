// TODO: fount-p2p 发布后改为 esm.sh 导入包内容，删除本地副本
import { isHex64, normalizeHex64 } from './hexIds.mjs'

/** 128 位小写 hex：`nodeHash(64)` + `subjectHash(64)`。 */
export const ENTITY_HASH_RE = /^[\da-f]{128}$/u

/**
 * @param {unknown} value 待校验值
 * @returns {boolean} 是否为合法 128 位 hex
 */
export function isEntityHash128(value) {
	const raw = String(value ?? '').trim().toLowerCase().replace(/^0x/iu, '')
	return ENTITY_HASH_RE.test(raw)
}

/**
 * @param {unknown} entityHash 128 位 entityHash
 * @returns {{ entityHash: string, nodeHash: string, subjectHash: string } | null} 解析结果；非法时 null
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

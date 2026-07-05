import { isHex64, normalizeHex64 } from './hexIds.mjs'

/** 128 位小写 hex：`nodeHash(64)` + `subjectHash(64)`。 */
export const ENTITY_HASH_RE = /^[\da-f]{128}$/u

/** agent subject 前缀（与 Chat 角色路径绑定）。 */
export const AGENT_SUBJECT_PREFIX = 'fount:chat:agent:'

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
 * @param {unknown} hash entityHash 或其它 hex 字符串
 * @param {{ withAt?: boolean, headLen?: number, tailLen?: number, useSubject?: boolean, ellipsis?: boolean }} [opts] 展示选项
 * @returns {string} 短标签
 */
export function formatHashShort(hash, opts = {}) {
	const {
		withAt = false,
		headLen = 8,
		tailLen = 4,
		useSubject = false,
		ellipsis = true,
	} = opts

	/** @param {string} label 已格式化的标签 @returns {string} */
	const prefix = label => withAt ? `@${label}` : label

	if (useSubject) {
		const parsed = parseEntityHash(hash)
		if (!parsed) return prefix('?')
		const sub = parsed.subjectHash
		if (tailLen > 0 && sub.length > headLen + tailLen)
			return prefix(`${sub.slice(0, headLen)}…${sub.slice(-tailLen)}`)
		if (ellipsis && sub.length > headLen)
			return prefix(`${sub.slice(0, headLen)}…`)
		return prefix(sub.slice(0, headLen))
	}

	const raw = String(hash ?? '').trim().toLowerCase()
	if (!raw) return prefix('?')
	if (raw.length <= headLen + (tailLen > 0 ? tailLen : 0) && !ellipsis)
		return prefix(raw)
	if (tailLen > 0 && raw.length > headLen + tailLen)
		return prefix(`${raw.slice(0, headLen)}…${raw.slice(-tailLen)}`)
	if (ellipsis && raw.length > headLen)
		return prefix(`${raw.slice(0, headLen)}…`)
	return prefix(raw.slice(0, headLen))
}

/**
 * @param {unknown} entityHash 128 位 entityHash
 * @returns {string} 短标签（subjectHash 8…4）
 */
export function entityHashLabel(entityHash) {
	return formatHashShort(entityHash, { useSubject: true, headLen: 8, tailLen: 4 })
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

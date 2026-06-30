/**
 *
 */
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
 * @param {unknown} entityHash 128 位 entityHash
 * @returns {string} 用于顶栏/列表的短标签
 */
export function entityHashLabel(entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return '?'
	return `${parsed.subjectHash.slice(0, 8)}…${parsed.subjectHash.slice(-4)}`
}

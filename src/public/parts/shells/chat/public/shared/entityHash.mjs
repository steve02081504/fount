/** entityHash 解析与展示（浏览器 / Deno / Node 共用；勿用 /scripts/ 绝对路径）。 */
export {
	ENTITY_HASH_RE,
	isEntityHash128,
	parseEntityHash,
} from 'https://esm.sh/@steve02081504/fount-p2p/core/entity_id_parse'

import { parseEntityHash } from 'https://esm.sh/@steve02081504/fount-p2p/core/entity_id_parse'

/**
 * @param {unknown} hash entityHash 或其它 hex 字符串
 * @param {{ withAt?: boolean, headLen?: number, tailLen?: number, useSubject?: boolean, ellipsis?: boolean }} [options] 展示选项
 * @returns {string} 短标签
 */
export function formatHashShort(hash, options = {}) {
	const {
		withAt = false,
		headLen = 8,
		tailLen = 4,
		useSubject = false,
		ellipsis = true,
	} = options

	/**
	 * @param {string} label 标签
	 * @returns {string} 带可选 @ 前缀的标签
	 */
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
 * @returns {string} 顶栏/列表短标签（subjectHash 8…4）
 */
export function entityHashLabel(entityHash) {
	return formatHashShort(entityHash, { useSubject: true, headLen: 8, tailLen: 4 })
}

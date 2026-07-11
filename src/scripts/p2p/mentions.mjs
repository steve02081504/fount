/**
 * P2P @ 提及：正文存 `@128hex entityHash`（Social / Chat 共用）。
 */
import { isEntityHash128 } from './entity_id.mjs'

/** @type {RegExp} 匹配 @ 后接 128 位 hex entityHash */
const MENTION_ENTITY_RE = /@([\da-f]{128})/giu

/**
 * 从正文提取 @ 提及的 entityHash 列表。
 * @param {string} text 正文
 * @returns {string[]} 去重后的 entityHash（小写）
 */
export function extractMentionEntityHashes(text) {
	const mentions = []
	const source = String(text || '')
	let match
	MENTION_ENTITY_RE.lastIndex = 0
	while ((match = MENTION_ENTITY_RE.exec(source)) !== null) {
		const hash = match[1].toLowerCase()
		if (isEntityHash128(hash)) mentions.push(hash)
	}
	return [...new Set(mentions)]
}

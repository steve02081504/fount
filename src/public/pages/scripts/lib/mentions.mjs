/** @ 提及解析（chat/social 共用；浏览器与 Deno 均可加载）。 */
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id_parse'

/** 匹配 @ 后接 128 位 hex entityHash */
const MENTION_ENTITY_RE = /@([\da-f]{128})/giu

/**
 * @param {string} text 正文
 * @returns {string[]} 去重后的 entityHash（小写）
 */
export function extractMentionEntityHashes(text) {
	const mentions = []
	let match
	MENTION_ENTITY_RE.lastIndex = 0
	while ((match = MENTION_ENTITY_RE.exec(text)) !== null) {
		const hash = match[1].toLowerCase()
		if (isEntityHash128(hash)) mentions.push(hash)
	}
	return [...new Set(mentions)]
}

/**
 * @param {{ entityHashes?: string[] }} mentions mentions 结构
 * @param {string} entityHash 待查实体
 * @returns {boolean} 是否直接 @ 命中
 */
export function mentionsEntity(mentions, entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!hash || !mentions?.entityHashes?.length) return false
	return mentions.entityHashes.some(entry => String(entry).trim().toLowerCase() === hash)
}

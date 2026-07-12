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

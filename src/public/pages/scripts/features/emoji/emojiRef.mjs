/**
 * emojiRef 规范：unicode 字形 | `:[emoji:packId/emojiId]:`。
 * 核心侧的解析/格式化（与 chat `shared/inlineTokenSyntax.mjs` 同构；核心不反向依赖 shell）。
 */

/** emojiId 位允许 unicode 别名（name/alt）；不含 `/`，以免吞掉额外 path 段。 */
const EMOJI_ID_IN_REF = '[^\\]/\\r\\n]+?'

/** 完整 emojiRef token（锚定匹配单个引用）。 */
const EMOJI_REF_TOKEN_RE = new RegExp(`^:?\\[emoji:([\\w.-]+)\\/(${EMOJI_ID_IN_REF})\\]:$`, 'u')

/**
 * @param {string} packId 表情包 ID
 * @param {string} emojiId 表情 ID
 * @returns {string} `:[emoji:packId/emojiId]:`
 */
export function formatEmojiRef(packId, emojiId) {
	return `:[emoji:${packId}/${emojiId}]:`
}

/**
 * 解析任意 emojiRef。
 * @param {string} emojiRef 表情引用
 * @returns {{ kind: 'pack', packId: string, emojiId: string } | { kind: 'unicode', unicode: string } | null} 解析结果
 */
export function parseEmojiRef(emojiRef) {
	const ref = String(emojiRef || '').trim()
	if (!ref) return null
	const m = EMOJI_REF_TOKEN_RE.exec(ref)
	if (m) return { kind: 'pack', packId: m[1], emojiId: m[2] }
	return { kind: 'unicode', unicode: ref }
}

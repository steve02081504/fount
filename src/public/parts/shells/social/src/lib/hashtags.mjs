/** 话题标签（不含 Chat `#[channel:…]` 等 typed hash token）。 */
export const HASHTAG_TOKEN_RE = /#([\p{L}\p{N}_-]{2,32})/gu

/**
 * 从正文提取话题标签（不含 Chat 群链标记）。
 * @param {string} text 正文
 * @returns {string[]} 小写话题列表（去重）
 */
export function extractHashtagsFromText(text) {
	const source = text || ''
	/** @type {Set<string>} */
	const tags = new Set()
	for (const match of source.matchAll(HASHTAG_TOKEN_RE)) {
		const index = match.index ?? 0
		if (index > 0 && source[index - 1] === '[') continue
		tags.add(match[1].toLowerCase())
	}
	return [...tags]
}

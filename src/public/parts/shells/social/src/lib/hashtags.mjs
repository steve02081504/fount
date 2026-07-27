/** 话题标签（不含 Chat `#[channel:…]` 等 typed hash token）。 */
export const HASHTAG_TOKEN_RE = /#([\p{L}\p{N}_-]{2,32})/gu

/**
 * 判断下标是否为行首（文件开头或换行后）。
 * @param {string} source 全文
 * @param {number} index 下标
 * @returns {boolean} 是否行首
 */
function isLineStart(source, index) {
	return index === 0 || source[index - 1] === '\n'
}

/**
 * 剥离 Markdown 行内代码与围栏代码，避免代码中的 `#tag` 被计入话题。
 * @param {string} text 正文
 * @returns {string} 剥离后文本（代码区替换为空格）
 */
export function stripMarkdownCodeForHashtags(text) {
	const source = String(text || '')
	let result = ''
	let i = 0
	while (i < source.length) {
		const ch = source[i]
		if ((ch === '`' || ch === '~') && isLineStart(source, i)) {
			let fenceLen = 0
			while (i + fenceLen < source.length && source[i + fenceLen] === ch) fenceLen++
			if (fenceLen >= 3) {
				const openLineEnd = source.indexOf('\n', i)
				if (openLineEnd < 0) {
					result += ' '
					break
				}
				let j = openLineEnd + 1
				let closed = false
				while (j < source.length) {
					const lineStart = j
					if (isLineStart(source, lineStart)) {
						let k = lineStart
						while (k < source.length && (source[k] === ' ' || source[k] === '\t')) k++
						let closeLen = 0
						while (k + closeLen < source.length && source[k + closeLen] === ch) closeLen++
						if (closeLen >= fenceLen) {
							let after = k + closeLen
							while (after < source.length && (source[after] === ' ' || source[after] === '\t')) after++
							if (after >= source.length || source[after] === '\n') {
								result += ' '
								i = after < source.length ? after + 1 : after
								closed = true
								break
							}
						}
					}
					const nextNl = source.indexOf('\n', j)
					j = nextNl < 0 ? source.length : nextNl + 1
				}
				if (closed) continue
				result += ' '
				break
			}
		}
		if (ch === '`') {
			let openLen = 0
			while (i + openLen < source.length && source[i + openLen] === '`') openLen++
			if (openLen < 3 || !isLineStart(source, i)) {
				const closer = '`'.repeat(openLen)
				const end = source.indexOf(closer, i + openLen)
				if (end >= 0 && !source.slice(i + openLen, end).includes('\n')) {
					result += ' '
					i = end + openLen
					continue
				}
			}
		}
		result += ch
		i++
	}
	return result
}

/**
 * 从正文提取话题标签（不含 Chat 群链标记与 Markdown 代码区）。
 * @param {string} text 正文
 * @returns {string[]} 小写话题列表（去重）
 */
export function extractHashtagsFromText(text) {
	const source = stripMarkdownCodeForHashtags(text || '')
	/** @type {Set<string>} */
	const tags = new Set()
	for (const match of source.matchAll(HASHTAG_TOKEN_RE)) {
		const index = match.index ?? 0
		if (index > 0 && source[index - 1] === '[') continue
		tags.add(match[1].toLowerCase())
	}
	return [...tags]
}

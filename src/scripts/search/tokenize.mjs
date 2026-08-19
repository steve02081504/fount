/** 分词器版本；变更后索引需重建。 */
export const TOKENIZER_VERSION = 1

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g
const HASHTAG_RE = /#[\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/gi
const WORD_RE = /[\da-z]+/gi

/**
 * @param {string} segment CJK 连续段
 * @returns {string[]} bigram 词元
 */
function cjkBigrams(segment) {
	const chars = [...segment]
	if (chars.length <= 1) return chars.length ? [segment] : []
	/** @type {string[]} */
	const tokens = []
	for (let i = 0; i < chars.length - 1; i++)
		tokens.push(`${chars[i]}${chars[i + 1]}`)
	return tokens
}

/**
 * @param {string} text 原始文本
 * @returns {string[]} 去重词元（小写）
 */
export function tokenizeForIndex(text) {
	if (!text) return []
	/** @type {Set<string>} */
	const tokens = new Set()

	for (const match of text.matchAll(HASHTAG_RE))
		tokens.add(match[0].toLowerCase())

	let stripped = text
	for (const match of text.matchAll(HASHTAG_RE))
		stripped = stripped.replace(match[0], ' ')

	for (const match of stripped.matchAll(CJK_RE))
		for (const token of cjkBigrams(match[0]))
			tokens.add(token)


	const latinOnly = stripped.replace(CJK_RE, ' ')
	for (const match of latinOnly.matchAll(WORD_RE))
		tokens.add(match[0].toLowerCase())

	return [...tokens]
}

/**
 * @param {string} query 用户查询
 * @returns {string[]} 查询词元
 */
export function tokenizeForQuery(query) {
	return tokenizeForIndex(query)
}

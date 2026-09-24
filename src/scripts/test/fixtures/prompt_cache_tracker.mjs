/**
 * 对话请求前缀复用统计（provider 无关）。
 *
 * 把每次请求的 prompt 序列化成稳定字符串，逐请求记录：
 * - 与「上一请求」的最长公共前缀（相邻复用，供 prompt caching 命中估算）；
 * - 与「首个请求」的最长公共前缀（会话头部稳定性）；
 * - 是否纯追加（`grewOnly`，即上一请求是当前请求的完整前缀）。
 *
 * OpenAI / Gemini / Claude 等各 wire 格式 mock 只需提供自己的 `serialize`。
 */

import { Buffer } from 'node:buffer'

/** 可缓存的最短前缀（OpenAI 文档下限；仅用于 OpenAI 映射）。 */
export const MIN_CACHE_TOKENS = 1024
/** 缓存命中粒度。 */
export const CACHE_TOKEN_INCREMENT = 128

/**
 * 以字符近似 token（缓存率只依赖相对比例，绝对尺度无关）。
 * @param {string} text 文本
 * @returns {number} token 数
 */
export function countTokens(text) {
	return String(text || '').length
}

/**
 * 两段序列的最长公共前缀长度。
 * @param {string} previous 上一序列
 * @param {string} current 当前序列
 * @returns {number} 公共前缀长度
 */
export function longestCommonPrefixLength(previous, current) {
	const limit = Math.min(previous.length, current.length)
	let index = 0
	while (index < limit && previous[index] === current[index]) index++
	return index
}

/**
 * 按 OpenAI 规则把公共前缀换算成 cached_tokens。
 * @param {number} commonPrefixTokens 公共前缀 token 数
 * @returns {number} cached_tokens
 */
export function cachedTokensFromPrefix(commonPrefixTokens) {
	if (commonPrefixTokens < MIN_CACHE_TOKENS) return 0
	return Math.floor(commonPrefixTokens / CACHE_TOKEN_INCREMENT) * CACHE_TOKEN_INCREMENT
}

/**
 * 创建跨请求前缀复用统计器。
 * @returns {{
 *   record: (serialized: string) => object,
 *   stats: () => object,
 *   reset: () => void,
 * }} 统计器
 */
export function createPrefixCacheTracker() {
	/** @type {string | null} */
	let firstSerialized = null
	/** @type {string | null} */
	let lastSerialized = null
	/** @type {object[]} */
	const perRequest = []
	let promptTokensTotal = 0
	let cachedTokensTotal = 0
	let prefixMatchTokensTotal = 0
	let firstMatchTokensTotal = 0

	/**
	 * 记录一次请求的序列化 prompt。
	 * @param {string} serialized 稳定序列化后的 prompt
	 * @returns {object} 该请求的统计行
	 */
	const record = serialized => {
		const promptTokens = countTokens(serialized)
		const previousSerialized = lastSerialized
		const first = firstSerialized
		const common = previousSerialized == null ? 0 : longestCommonPrefixLength(previousSerialized, serialized)
		const commonWithFirst = first == null ? promptTokens : longestCommonPrefixLength(first, serialized)
		const cachedTokens = previousSerialized == null ? 0 : cachedTokensFromPrefix(common)
		if (firstSerialized == null) firstSerialized = serialized
		lastSerialized = serialized

		promptTokensTotal += promptTokens
		cachedTokensTotal += cachedTokens
		prefixMatchTokensTotal += common
		firstMatchTokensTotal += commonWithFirst

		const grewOnly = previousSerialized == null ||
			(common === previousSerialized.length && serialized.length >= previousSerialized.length)
		const row = {
			promptTokens,
			cachedTokens,
			prefixMatchTokens: common,
			commonPrefixTokens: common,
			commonWithFirstTokens: commonWithFirst,
			cacheRate: promptTokens > 0 ? cachedTokens / promptTokens : 0,
			prefixMatchRate: promptTokens > 0 ? common / promptTokens : 0,
			grewOnly,
			divergeAt: previousSerialized == null || grewOnly
				? null
				: {
					index: common,
					prev: previousSerialized.slice(Math.max(0, common - 40), common + 80),
					curr: serialized.slice(Math.max(0, common - 40), common + 80),
				},
		}
		perRequest.push(row)
		return row
	}

	/**
	 * 汇总统计。
	 * @returns {object} 统计
	 */
	const stats = () => ({
		requests: perRequest.length,
		promptTokens: promptTokensTotal,
		cachedTokens: cachedTokensTotal,
		prefixMatchTokens: prefixMatchTokensTotal,
		firstMatchTokens: firstMatchTokensTotal,
		cacheRate: promptTokensTotal > 0 ? cachedTokensTotal / promptTokensTotal : 0,
		prefixMatchRate: promptTokensTotal > 0 ? prefixMatchTokensTotal / promptTokensTotal : 0,
		firstMatchRate: promptTokensTotal > 0 ? firstMatchTokensTotal / promptTokensTotal : 0,
		firstPromptTokens: firstSerialized == null ? 0 : firstSerialized.length,
		minCommonWithFirstTokens: perRequest.length
			? Math.min(...perRequest.map(row => row.commonWithFirstTokens))
			: 0,
		allGrewOnly: perRequest.length > 0 && perRequest.every(row => row.grewOnly),
		perRequest: [...perRequest],
	})

	/**
	 * 清空全部累计状态。
	 * @returns {void}
	 */
	const reset = () => {
		firstSerialized = null
		lastSerialized = null
		perRequest.length = 0
		promptTokensTotal = 0
		cachedTokensTotal = 0
		prefixMatchTokensTotal = 0
		firstMatchTokensTotal = 0
	}

	return { record, stats, reset }
}

/**
 * 读取请求体为 UTF-8 字符串。
 * @param {import('node:http').IncomingMessage} req 请求
 * @returns {Promise<string>} 请求体
 */
export async function readRequestBody(req) {
	const chunks = []
	for await (const chunk of req) chunks.push(chunk)
	return Buffer.concat(chunks).toString('utf8')
}

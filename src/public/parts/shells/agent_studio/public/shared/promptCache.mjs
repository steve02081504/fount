/** 以相邻请求的公共前缀估算 prompt 缓存复用率（字符口径，并非供应商计费 token）。 */

/**
 * 判断一次请求快照是否可作为缓存比较基准。
 * @param {object} request 请求快照
 * @returns {boolean} 是否有效
 */
function isComparableRequest(request) {
	return typeof request?.systemPrompt === 'string' && Array.isArray(request.messages)
}

/**
 * 把一次请求快照序列化为可比较的字符串。
 * @param {object} request 请求快照
 * @returns {string} 序列化文本
 */
export function serializeRequest(request) {
	return [request.systemPrompt, ...(request.messages ?? []).map(message => `${message.role}\n${message.content ?? ''}`)].join('\n')
}

/**
 * 计算两个序列化 prompt 的公共前缀字符数。
 * @param {string} a 文本 a
 * @param {string} b 文本 b
 * @returns {number} 公共前缀字符数
 */
export function commonPrefixLength(a, b) {
	const max = Math.min(a.length, b.length)
	let prefix = 0
	while (prefix < max && a[prefix] === b[prefix]) prefix++
	return prefix
}

/**
 * 为会话中每次生成提供估算缓存率；快照过期或没有上次请求时返回 null。
 * @param {object[]} generations 顺序排列的生成记录
 * @returns {Array<{ rate: number | null, reused: number, total: number }>} 每次生成的指标
 */
export function estimatePromptCache(generations = []) {
	let previous = null
	return generations.map(generation => {
		let reused = 0
		let total = 0
		if (!generation.requests?.length) previous = null
		for (const request of generation.requests ?? []) {
			if (!isComparableRequest(request)) continue
			const current = serializeRequest(request)
			if (previous != null) {
				reused += commonPrefixLength(current, previous)
				total += current.length
			}
			previous = current
		}
		return { rate: total ? reused / total : null, reused, total }
	})
}

/**
 * 估算单次生成相对上一轮 prompt 的缓存复用率（供列表页预计算，无需载入完整会话）。
 * @param {string | null} previousPrompt 上一次请求的序列化 prompt（缺失时为 null）
 * @param {object[]} requests 本次生成的逐轮请求快照
 * @returns {{ rate: number | null, reused: number, total: number }} 指标
 */
export function estimateGenerationCache(previousPrompt, requests = []) {
	let previous = typeof previousPrompt === 'string' ? previousPrompt : null
	let reused = 0
	let total = 0
	for (const request of requests ?? []) {
		if (!isComparableRequest(request)) continue
		const current = serializeRequest(request)
		if (previous != null) {
			reused += commonPrefixLength(current, previous)
			total += current.length
		}
		previous = current
	}
	return { rate: total ? reused / total : null, reused, total }
}

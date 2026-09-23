/** 以相邻请求的公共前缀估算 prompt 缓存复用率（字符口径，并非供应商计费 token）。 */

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
			if (typeof request.systemPrompt !== 'string' || !Array.isArray(request.messages)) continue
			const parts = [request.systemPrompt, ...request.messages.map(message => `${message.role}\n${message.content ?? ''}`)]
			const current = parts.join('\n')
			if (previous != null) {
				let prefix = 0
				while (prefix < current.length && prefix < previous.length && current[prefix] === previous[prefix]) prefix++
				reused += prefix
				total += current.length
			}
			previous = current
		}
		return { rate: total ? reused / total : null, reused, total }
	})
}

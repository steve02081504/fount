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
 * 优先取记录时由 AI 源 `BuildPrompt` 构建并序列化的 `snapshot`（真实出站形态）；缺失（旧记录或无 BuildPrompt 的源）时回退到系统提示 + 消息拼接。
 * @param {object} request 请求快照
 * @returns {string} 序列化文本
 */
export function serializeRequest(request) {
	if (typeof request?.snapshot === 'string') return request.snapshot
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
 * `rounds` 逐轮给出该生成的每次请求相对上一请求的复用率，供按轮次绘制的图表与回放对位。
 *
 * 复用率 = 两请求公共前缀字符数 / **上一请求**字符数：衡量「上一请求有多少成为这一请求的开头」。
 * 上一请求被完整复用（本轮只是追加内容）时为 100%，不会因新增内容越长而被稀释到看似诱人的低值。
 * 生成的汇总 `rate` 取各轮 `rate` 的算术平均（每轮以该轮上一请求长度归一），
 * 而不是 `reused / 各轮长度之和`——后者同样会把纯追加的完整复用压到远低于 100%。
 * @param {object[]} generations 顺序排列的生成记录
 * @returns {Array<{ rate: number | null, reused: number, total: number, rounds: Array<{ rate: number | null, reused: number, total: number }> }>} 每次生成的指标
 */
export function estimatePromptCache(generations = []) {
	let previous = null
	return generations.map(generation => {
		let reused = 0
		let total = 0
		const rounds = []
		if (!generation.requests?.length) previous = null
		for (const request of generation.requests ?? []) {
			if (!isComparableRequest(request)) {
				rounds.push({ rate: null, reused: 0, total: 0 })
				continue
			}
			const current = serializeRequest(request)
			const roundReused = previous != null ? commonPrefixLength(current, previous) : 0
			if (previous != null) {
				reused += roundReused
				total += previous.length
			}
			rounds.push({ rate: previous != null && previous.length ? roundReused / previous.length : null, reused: roundReused, total: previous != null ? previous.length : 0 })
			previous = current
		}
		return { rate: averageRoundRate(rounds), reused, total, rounds }
	})
}

/**
 * 汇总逐轮复用率为生成级指标：取各轮非空 `rate` 的算术平均；全为空时返回 null。
 * @param {Array<{ rate: number | null }>} rounds 逐轮指标
 * @returns {number | null} 生成级复用率
 */
export function averageRoundRate(rounds = []) {
	let sum = 0
	let count = 0
	for (const round of rounds)
		if (typeof round?.rate === 'number' && Number.isFinite(round.rate)) {
			sum += round.rate
			count++
		}
	return count ? sum / count : null
}

/**
 * 估算单次生成相对上一轮 prompt 的缓存复用率（供列表页预计算，无需载入完整会话）。
 * 与 `estimatePromptCache` 同口径：复用率以**上一请求**长度为分母，生成级 `rate` 取各轮复用率的算术平均。
 * @param {string | null} previousPrompt 上一次请求的序列化 prompt（缺失时为 null）
 * @param {object[]} requests 本次生成的逐轮请求快照
 * @returns {{ rate: number | null, reused: number, total: number }} 指标
 */
export function estimateGenerationCache(previousPrompt, requests = []) {
	let previous = typeof previousPrompt === 'string' ? previousPrompt : null
	const rounds = []
	let reused = 0
	let total = 0
	for (const request of requests ?? []) {
		if (!isComparableRequest(request)) continue
		const current = serializeRequest(request)
		if (previous != null) {
			const roundReused = commonPrefixLength(current, previous)
			reused += roundReused
			total += previous.length
			rounds.push({ rate: previous.length ? roundReused / previous.length : null })
		}
		previous = current
	}
	return { rate: averageRoundRate(rounds), reused, total }
}

/** 以相邻请求前缀及上一请求输出估算缓存复用率（字符口径，并非供应商计费 token）。 */

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
 * JSON 快照末尾的容器闭合符不会是下一轮追加消息的前缀。
 * @param {object} request 请求
 * @returns {string} 可比较的前缀
 */
function comparableText(request) {
	const text = serializeRequest(request)
	return typeof request?.snapshot === 'string' ? text.replace(/(\s*[\]}])+\s*$/, '') : text
}

/**
 * 取上轮输出，并判断它是否作为下一请求的首个新增角色消息被原样带入。
 * 输出缺失的旧记录从最终回复或下一请求新增的角色消息中恢复；发生压缩/修改时不能凭字符串在别处出现就算复用。
 * @param {object} previous 上一请求
 * @param {object} current 本次请求
 * @param {unknown} finalResponse 上一代最终回复
 * @returns {{ output: string | null, carried: boolean }} 上轮输出与是否被带入
 */
function previousOutput(previous, current, finalResponse) {
	const added = (current.messages ?? []).slice(previous.messages?.length ?? 0)
	const previousIds = new Set((previous.messages ?? []).map(message => message.id).filter(Boolean))
	const recovered = added.find(message => message.role === 'char' && (!message.id || !previousIds.has(message.id)))?.content ?? null
	const output = typeof previous.output === 'string' ? previous.output : typeof finalResponse === 'string' ? finalResponse : recovered
	const firstAdded = added[0]
	const carried = !!output && firstAdded?.role === 'char' && firstAdded.content === output && (!firstAdded.id || !previousIds.has(firstAdded.id))
	return { output, carried }
}

/**
 * 每轮用上一请求及其模型输出作为可缓存基底；快照的 JSON 容器尾巴不计入前缀。
 * @param {object | null} previous 上一请求
 * @param {object} current 本次请求
 * @param {string | null} [finalResponse] 上一代回复
 * @returns {{rate: number | null, reused: number, total: number}} 本轮指标
 */
export function estimateRoundCache(previous, current, finalResponse = null) {
	if (!previous || !isComparableRequest(previous) || !isComparableRequest(current)) return { rate: null, reused: 0, total: 0 }
	const basis = comparableText(previous)
	const text = serializeRequest(current)
	const { output, carried } = previousOutput(previous, current, finalResponse)
	const outputLength = output?.length ?? 0
	const total = basis.length + outputLength
	const prefix = commonPrefixLength(text, basis)
	const reused = prefix + (carried && prefix === basis.length ? outputLength : 0)
	return { rate: total ? reused / total : null, reused, total }
}

/**
 * 为会话中每次生成提供估算缓存率；快照过期或没有上次请求时返回 null。
 * `rounds` 逐轮给出该生成的每次请求相对上一请求的复用率，供按轮次绘制的图表与回放对位。
 *
 * 复用率 = （请求公共前缀 + 下一请求实际带入的上一轮输出）/（上一请求可比较文本长度 + 上一轮输出长度）。
 * 上一请求与输出被完整带入时为 100%，新增内容不稀释该比例。
 * 生成的汇总 `rate` 取各轮 `rate` 的算术平均（每轮以该轮上一请求长度归一），
 * 而不是 `reused / 各轮基底长度之和`。
 * @param {object[]} generations 顺序排列的生成记录
 * @returns {Array<{ rate: number | null, reused: number, total: number, rounds: Array<{ rate: number | null, reused: number, total: number }> }>} 每次生成的指标
 */
export function estimatePromptCache(generations = []) {
	let previous = null
	let previousResponse = null
	return generations.map(generation => {
		let reused = 0
		let total = 0
		const rounds = []
		if (!generation.requests?.length) { previous = null; previousResponse = null }
		for (const request of generation.requests ?? []) {
			if (!isComparableRequest(request)) {
				rounds.push({ rate: null, reused: 0, total: 0 })
				continue
			}
			const round = estimateRoundCache(previous, request, previousResponse)
			reused += round.reused
			total += round.total
			rounds.push(round)
			previous = request
			previousResponse = null
		}
		if (generation.requests?.length) previousResponse = generation.response
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
 * 与 `estimatePromptCache` 同口径：分母含上一请求与其输出，生成级 `rate` 取各轮复用率的算术平均。
 * @param {object | string | null} previousPrompt 上一次请求快照（旧调用传字符串时仅能比较请求本身）
 * @param {object[]} requests 本次生成的逐轮请求快照
 * @returns {{ rate: number | null, reused: number, total: number }} 指标
 */
export function estimateGenerationCache(previousPrompt, requests = []) {
	let previous = typeof previousPrompt === 'string' ? { snapshot: previousPrompt, systemPrompt: '', messages: [], output: '' } : previousPrompt
	let previousResponse = previousPrompt?.response
	const rounds = []
	let reused = 0
	let total = 0
	for (const request of requests ?? []) {
		if (!isComparableRequest(request)) continue
		if (previous != null) {
			const round = estimateRoundCache(previous, request, previousResponse)
			reused += round.reused
			total += round.total
			rounds.push(round)
		}
		previous = request
		previousResponse = null
	}
	return { rate: averageRoundRate(rounds), reused, total }
}

/**
 * OpenAI Chat Completions 格式 mock：按前缀复用模拟 prompt caching。
 * 规则对齐 OpenAI 自动缓存：≥1024 token 起计，按 128 token 递增；
 * cached_tokens 取与「上一请求」的最长公共前缀（向下取整到 128）。
 */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

/** 可缓存的最短前缀（OpenAI 文档下限）。 */
export const MIN_CACHE_TOKENS = 1024
/** 缓存命中粒度。 */
export const CACHE_TOKEN_INCREMENT = 128

/**
 * 将 messages 序列化为稳定字符串（用于前缀比较）。
 * @param {Array<{ role?: string, content?: unknown }>} messages OpenAI messages
 * @returns {string} 序列化结果
 */
export function serializeMessages(messages) {
	return (messages || []).map(message => {
		const content = typeof message.content === 'string'
			? message.content
			: JSON.stringify(message.content ?? '')
		return `${message.role ?? ''}\0${content}`
	}).join('\n')
}

/**
 * 以字符近似 token（缓存率只依赖相对比例，绝对尺度无关）。
 * @param {string} text 文本
 * @returns {number} token 数
 */
export function countTokens(text) {
	return String(text || '').length
}

/**
 * 两段 token 序列的最长公共前缀长度。
 * @param {string} previous 上一请求序列
 * @param {string} current 当前请求序列
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
 * 创建带 prompt 缓存统计的 OpenAI mock 服务。
 * @param {object} [options] 选项
 * @param {(body: object) => string} [options.reply] 根据请求体生成回复文本
 * @returns {Promise<{
 *   url: string,
 *   completionsUrl: string,
 *   port: number,
 *   close: () => Promise<void>,
 *   stats: () => { requests: number, promptTokens: number, cachedTokens: number, cacheRate: number, perRequest: object[] },
 *   reset: () => void,
 * }>} mock 句柄
 */
export async function startOpenAIPromptCacheMock(options = {}) {
	/** @type {string | null} */
	let lastSerialized = null
	/** @type {object[]} */
	const perRequest = []
	let promptTokensTotal = 0
	let cachedTokensTotal = 0
	let prefixMatchTokensTotal = 0

	/**
	 * @param {object} body 请求体
	 * @returns {string} 回复
	 */
	const reply = options.reply ?? (body => {
		// 不要回显带 <message>/<content> 的用户原文：proxy clearFormat 会按角色卡格式剥离。
		return `mock-ok:messages=${(body.messages || []).length}`
	})

	/**
	 * 重置缓存状态与累计。
	 * @returns {void}
	 */
	const reset = () => {
		lastSerialized = null
		perRequest.length = 0
		promptTokensTotal = 0
		cachedTokensTotal = 0
		prefixMatchTokensTotal = 0
	}

	/**
	 * @returns {{ requests: number, promptTokens: number, cachedTokens: number, prefixMatchTokens: number, cacheRate: number, prefixMatchRate: number, perRequest: object[] }} 统计
	 */
	const stats = () => ({
		requests: perRequest.length,
		promptTokens: promptTokensTotal,
		cachedTokens: cachedTokensTotal,
		prefixMatchTokens: prefixMatchTokensTotal,
		cacheRate: promptTokensTotal > 0 ? cachedTokensTotal / promptTokensTotal : 0,
		prefixMatchRate: promptTokensTotal > 0 ? prefixMatchTokensTotal / promptTokensTotal : 0,
		perRequest: [...perRequest],
	})

	const server = createServer(async (req, res) => {
		if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ ok: true, ...stats() }))
			return
		}

		if (req.method !== 'POST' || !String(req.url || '').includes('/chat/completions')) {
			res.writeHead(404, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error' } }))
			return
		}

		const chunks = []
		for await (const chunk of req) chunks.push(chunk)
		const raw = Buffer.concat(chunks).toString('utf8')
		const body = raw ? JSON.parse(raw) : {}
		const serialized = serializeMessages(body.messages || [])
		const promptTokens = countTokens(serialized)
		const previousSerialized = lastSerialized
		const common = previousSerialized == null ? 0 : longestCommonPrefixLength(previousSerialized, serialized)
		const cachedTokens = previousSerialized == null ? 0 : cachedTokensFromPrefix(common)
		lastSerialized = serialized
		promptTokensTotal += promptTokens
		cachedTokensTotal += cachedTokens
		prefixMatchTokensTotal += common

		const content = reply(body)
		const completionTokens = countTokens(content)
		const usage = {
			prompt_tokens: promptTokens,
			completion_tokens: completionTokens,
			total_tokens: promptTokens + completionTokens,
			prompt_tokens_details: { cached_tokens: cachedTokens },
		}
		const grewOnly = previousSerialized != null && common === previousSerialized.length && serialized.length >= previousSerialized.length
		perRequest.push({
			promptTokens,
			cachedTokens,
			prefixMatchTokens: common,
			commonPrefixTokens: common,
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
		})

		const payload = {
			id: `chatcmpl-mock-${perRequest.length}`,
			object: 'chat.completion',
			created: Math.floor(Date.now() / 1000),
			model: body.model || 'mock-cache',
			choices: [{
				index: 0,
				message: { role: 'assistant', content },
				finish_reason: 'stop',
			}],
			usage,
		}

		if (body.stream) {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			})
			res.write(`data: ${JSON.stringify({
				id: payload.id,
				object: 'chat.completion.chunk',
				created: payload.created,
				model: payload.model,
				choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
			})}\n\n`)
			res.write(`data: ${JSON.stringify({
				id: payload.id,
				object: 'chat.completion.chunk',
				created: payload.created,
				model: payload.model,
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
				usage,
			})}\n\n`)
			res.write('data: [DONE]\n\n')
			res.end()
			return
		}

		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(payload))
	})

	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', resolve)
	})
	const address = server.address()
	const port = typeof address === 'object' && address ? address.port : 0
	const url = `http://127.0.0.1:${port}`

	return {
		url,
		completionsUrl: `${url}/v1/chat/completions`,
		port,
		stats,
		reset,
		/**
		 * 关闭 mock HTTP 服务。
		 * @returns {Promise<void>}
		 */
		close: () => new Promise((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve())
		}),
	}
}

if (import.meta.main) {
	const mock = await startOpenAIPromptCacheMock()
	console.log(`openai prompt-cache mock listening on ${mock.completionsUrl}`)
}

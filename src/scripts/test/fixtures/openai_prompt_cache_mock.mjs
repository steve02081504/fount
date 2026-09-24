/**
 * OpenAI Chat Completions 格式 mock：按前缀复用模拟 prompt caching。
 * 规则对齐 OpenAI 自动缓存：≥1024 token 起计，按 128 token 递增；
 * cached_tokens 取与「上一请求」的最长公共前缀（向下取整到 128）。
 *
 * 前缀统计与缓存数学见 [prompt_cache_tracker.mjs](./prompt_cache_tracker.mjs)。
 */
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'

import { countTokens, createPrefixCacheTracker } from './prompt_cache_tracker.mjs'

/** 可缓存的最短前缀（OpenAI 文档下限）。 */
export { CACHE_TOKEN_INCREMENT, MIN_CACHE_TOKENS, cachedTokensFromPrefix, countTokens, longestCommonPrefixLength } from './prompt_cache_tracker.mjs'

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
 * 创建带 prompt 缓存统计的 OpenAI mock 服务。
 * @param {object} [options] 选项
 * @param {(body: object) => string} [options.reply] 根据请求体生成回复文本
 * @returns {Promise<{
 *   url: string,
 *   completionsUrl: string,
 *   port: number,
 *   close: () => Promise<void>,
 *   stats: () => object,
 *   reset: () => void,
 * }>} mock 句柄
 */
export async function startOpenAIPromptCacheMock(options = {}) {
	const tracker = createPrefixCacheTracker()

	/**
	 * @param {object} body 请求体
	 * @returns {string} 回复
	 */
	const reply = options.reply ?? (body => {
		// 不要回显带 <message>/<content> 的用户原文：proxy clearFormat 会按角色卡格式剥离。
		return `mock-ok:messages=${(body.messages || []).length}`
	})

	const server = createServer(async (req, res) => {
		if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ ok: true, ...tracker.stats() }))
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
		const row = tracker.record(serializeMessages(body.messages || []))

		const content = reply(body)
		const completionTokens = countTokens(content)
		const usage = {
			prompt_tokens: row.promptTokens,
			completion_tokens: completionTokens,
			total_tokens: row.promptTokens + completionTokens,
			prompt_tokens_details: { cached_tokens: row.cachedTokens },
		}

		const payload = {
			id: `chatcmpl-mock-${tracker.stats().requests}`,
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
		stats: tracker.stats,
		reset: tracker.reset,
		/**
		 * 关闭 mock HTTP 服务。
		 * @returns {Promise<void>}
		 */
		close: () => new Promise((resolve, reject) => {
			server.closeAllConnections?.()
			server.close(error => error ? reject(error) : resolve())
		}),
	}
}

if (import.meta.main) {
	const mock = await startOpenAIPromptCacheMock()
	console.log(`openai prompt-cache mock listening on ${mock.completionsUrl}`)
}

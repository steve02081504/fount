/**
 * Anthropic Messages API 格式 mock：按 `system` + `messages` 前缀复用统计。
 *
 * 覆盖 `@anthropic-ai/sdk` 的 `POST /v1/messages`（含流式 SSE）。
 * 配置 `base_url` 指向此 mock 即可让 `serviceGenerators/AI/claude-api` 使用它。
 */
import { createServer } from 'node:http'

import { countTokens, createPrefixCacheTracker, readRequestBody } from './prompt_cache_tracker.mjs'

/**
 * 把 Anthropic 请求的 `system` + `messages` 序列化为稳定字符串（用于前缀比较）。
 * @param {{ system?: unknown, messages?: Array<{ role?: string, content?: unknown }> }} body 请求体
 * @returns {string} 序列化结果
 */
export function serializeClaudeRequest(body) {
	const system = typeof body.system === 'string'
		? body.system
		: JSON.stringify(body.system ?? '')
	const messages = (body.messages || []).map(message => {
		const content = typeof message.content === 'string'
			? message.content
			: (message.content || []).map(block => block?.type === 'text' ? block.text : JSON.stringify(block)).join('')
		return `${message.role ?? ''}\0${content}`
	}).join('\n')
	return `${system}\n${messages}`
}

/**
 * 构造一个 Anthropic Message 响应体。
 * @param {string} text 回复文本
 * @param {number} inputTokens 输入 token 数
 * @returns {object} Message
 */
function claudeMessage(text, inputTokens) {
	return {
		id: 'msg_mock',
		type: 'message',
		role: 'assistant',
		model: 'mock-claude',
		content: [{ type: 'text', text }],
		stop_reason: 'end_turn',
		stop_sequence: null,
		usage: { input_tokens: inputTokens, output_tokens: countTokens(text) },
	}
}

/**
 * 创建带 prompt 前缀复用统计的 Anthropic mock 服务。
 * @param {object} [options] 选项
 * @param {(body: object) => string} [options.reply] 根据请求体生成回复文本
 * @returns {Promise<{ url: string, baseUrl: string, port: number, stats: () => object, reset: () => void, close: () => Promise<void> }>} mock 句柄
 */
export async function startClaudePromptCacheMock(options = {}) {
	const tracker = createPrefixCacheTracker()
	const reply = options.reply ?? (body => `mock-ok:messages=${(body.messages || []).length}`)

	const server = createServer(async (req, res) => {
		const url = String(req.url || '')

		if (req.method === 'GET' && (url === '/' || url === '/health')) {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ ok: true, ...tracker.stats() }))
			return
		}

		if (req.method !== 'POST' || !url.includes('/messages')) {
			res.writeHead(404, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }))
			return
		}

		const raw = await readRequestBody(req)
		const body = raw ? JSON.parse(raw) : {}
		const row = tracker.record(serializeClaudeRequest(body))
		const text = reply(body)

		if (body.stream) {
			const message = claudeMessage('', row.promptTokens)
			const frames = [
				['message_start', { type: 'message_start', message }],
				['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
				['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
				['content_block_stop', { type: 'content_block_stop', index: 0 }],
				['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: countTokens(text) } }],
				['message_stop', { type: 'message_stop' }],
			]
			res.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			})
			for (const [event, data] of frames)
				res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
			res.end()
			return
		}

		res.writeHead(200, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify(claudeMessage(text, row.promptTokens)))
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
		baseUrl: url,
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
	const mock = await startClaudePromptCacheMock()
	console.log(`claude prompt-cache mock listening on ${mock.url}`)
}

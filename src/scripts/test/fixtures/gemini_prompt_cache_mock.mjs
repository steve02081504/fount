/**
 * Gemini API 格式 mock：按 `contents` 前缀复用统计（@google/genai 客户端）。
 *
 * 覆盖 `@google/genai` 客户端在非 Vertex 模式下的调用：
 * - `POST /v1beta/models/{model}:generateContent`
 * - `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`
 * - `POST /v1beta/models/{model}:countTokens`
 *
 * 配置 `base_url` 指向此 mock 即可让 `serviceGenerators/AI/gemini` 使用它。
 */
import { createServer } from 'node:http'

import { countTokens, createPrefixCacheTracker, readRequestBody } from './prompt_cache_tracker.mjs'

/**
 * 把 Gemini `contents` 序列化为稳定字符串（用于前缀比较）。
 * @param {Array<{ role?: string, parts?: Array<object> }>} contents Gemini contents
 * @returns {string} 序列化结果
 */
export function serializeGeminiContents(contents) {
	return (contents || []).map(content => {
		const parts = (content.parts || []).map(part => {
			if (typeof part.text === 'string') return part.text
			return JSON.stringify(part)
		}).join('')
		return `${content.role ?? ''}\0${parts}`
	}).join('\n')
}

/**
 * 构造一个 Gemini 非流式响应体。
 * @param {string} text 回复文本
 * @returns {object} GenerateContentResponse
 */
function geminiResponse(text) {
	return {
		candidates: [{
			content: { role: 'model', parts: [{ text }] },
			finishReason: 'STOP',
		}],
		usageMetadata: {
			promptTokenCount: 0,
			candidatesTokenCount: 0,
			totalTokenCount: 0,
		},
	}
}

/**
 * 创建带 prompt 前缀复用统计的 Gemini mock 服务。
 * @param {object} [options] 选项
 * @param {(body: object) => string} [options.reply] 根据请求体生成回复文本
 * @returns {Promise<{ url: string, baseUrl: string, port: number, stats: () => object, reset: () => void, close: () => Promise<void> }>} mock 句柄
 */
export async function startGeminiPromptCacheMock(options = {}) {
	const tracker = createPrefixCacheTracker()
	const reply = options.reply ?? (body => `mock-ok:contents=${(body.contents || []).length}`)

	const server = createServer(async (req, res) => {
		const url = String(req.url || '')

		if (req.method === 'GET' && (url === '/' || url === '/health')) {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ ok: true, ...tracker.stats() }))
			return
		}

		const raw = await readRequestBody(req)
		const body = raw ? JSON.parse(raw) : {}

		if (req.method === 'POST' && url.includes(':countTokens')) {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ totalTokens: countTokens(serializeGeminiContents(body.contents || [])) }))
			return
		}

		if (req.method === 'POST' && url.includes(':generateContent')) {
			const row = tracker.record(serializeGeminiContents(body.contents || []))
			const text = reply(body)
			const payload = geminiResponse(text)
			payload.usageMetadata.promptTokenCount = row.promptTokens
			payload.usageMetadata.candidatesTokenCount = countTokens(text)
			payload.usageMetadata.totalTokenCount = row.promptTokens + countTokens(text)
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(payload))
			return
		}

		if (req.method === 'POST' && url.includes(':streamGenerateContent')) {
			const row = tracker.record(serializeGeminiContents(body.contents || []))
			const text = reply(body)
			const payload = geminiResponse(text)
			payload.usageMetadata.promptTokenCount = row.promptTokens
			const frame = JSON.stringify(payload)
			res.writeHead(200, {
				'Content-Type': 'text/event-stream; charset=utf-8',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			})
			res.write(`data: ${frame}\n\n`)
			res.end()
			return
		}

		res.writeHead(404, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: { code: 404, message: 'not found', status: 'NOT_FOUND' } }))
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
	const mock = await startGeminiPromptCacheMock()
	console.log(`gemini prompt-cache mock listening on ${mock.url}`)
}

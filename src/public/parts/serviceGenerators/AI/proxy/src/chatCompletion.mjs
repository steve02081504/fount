import { fetchResponses, messagesToResponsesBody } from '../../codex/src/responsesClient.mjs'

import { completionsUrlCandidates } from './completionsUrl.mjs'
import { responsesUrlCandidates, urlImpliesResponses } from './responsesUrl.mjs'

/** Chat Completions 专有的请求参数，Responses API 不接受，转发前需剔除。 */
const CHAT_ONLY_ARGUMENTS = new Set([
	'n', 'logprobs', 'top_logprobs', 'stop', 'frequency_penalty', 'presence_penalty',
	'seed', 'response_format', 'stream_options', 'logit_bias', 'user',
])

/**
 * 把 proxy 的 `model_arguments` 过滤成 Responses API 可接受的参数。
 * @param {object} [model_arguments] - 原始参数。
 * @returns {object} 过滤后的参数。
 */
export function toResponsesArguments(model_arguments) {
	const result = {}
	for (const [key, value] of Object.entries(model_arguments ?? {}))
		if (key === 'max_tokens') result.max_output_tokens ??= value
		else if (!CHAT_ONLY_ARGUMENTS.has(key)) result[key] = value

	return result
}

/**
 * 构建两种 OpenAI API 风格共用的请求头。
 * @param {object} requestConfig - 服务配置。
 * @returns {Record<string, string>} 请求头。
 */
function requestHeaders(requestConfig) {
	return {
		'Content-Type': 'application/json',
		...requestConfig.apikey ? { Authorization: 'Bearer ' + requestConfig.apikey } : {},
		'HTTP-Referer': 'https://steve02081504.github.io/fount/',
		'X-Title': 'fount',
		...requestConfig.url.includes('openrouter.ai') ? {
			'X-OpenRouter-Title': 'fount',
			'X-OpenRouter-Categories': 'personal-agent,productivity,roleplay',
		} : {},
		...requestConfig.custom_headers,
	}
}

/**
 * 按 `config.api_mode` 与配置 URL 解析请求候选（URL + API 风格），保持优先级顺序。
 *
 * - `chat`：仅 chat completions
 * - `responses`：仅 Responses
 * - `auto`（默认）：URL 指向 `/responses` 时先 Responses 再 chat，否则先 chat 再 Responses
 *
 * @param {object} config - 服务配置。
 * @returns {Array<{url: string, apiStyle: 'chat' | 'responses'}>} 候选请求。
 */
export function requestCandidates(config) {
	const chat = completionsUrlCandidates(config.url).map(url => ({ url, apiStyle: 'chat' }))
	const responses = responsesUrlCandidates(config.url).map(url => ({ url, apiStyle: 'responses' }))

	switch (config.api_mode) {
		case 'chat': return chat
		case 'responses': return responses
		default:
			return urlImpliesResponses(config.url)
				? [...responses, ...chat]
				: [...chat, ...responses]
	}
}

/**
 * 创建带重试的聊天补全请求函数。
 * @param {object} config - 服务配置（会在 URL 自动修正时被更新）。
 * @param {{ SaveConfig: Function }} deps - 依赖项。
 * @returns {(messages: Array<object>, options?: { signal?: AbortSignal, previewUpdater?: Function, result?: {content: string, content_for_show?: string, files: any[], extension?: object} }) => Promise<{content: string, content_for_show?: string, files: any[], extension?: object}>} 返回带重试的聊天补全请求函数。
 */
export function createFetchChatCompletionWithRetry(config, { SaveConfig }) {
	/**
	 * 调用基础模型。
	 * @param {Array<object>} messages - 消息数组。
	 * @param {object} requestConfig - 配置对象。
	 * @param {object} options - 选项对象。
	 * @param {AbortSignal} options.signal - 用于中止请求的 AbortSignal。
	 * @param {(result: {content: string, content_for_show?: string, files: any[]}) => void} options.previewUpdater - 处理部分结果的回调函数。
	 * @param {{content: string, content_for_show?: string, files: any[], extension?: object}} options.result - 包含内容和文件的结果对象。
	 * @returns {Promise<{content: string, content_for_show?: string, files: any[], extension?: object}>} 模型返回的内容。
	 */
	async function fetchChatCompletion(messages, requestConfig, {
		signal,
		previewUpdater = () => { },
		result = { content: '', files: [] },
	}) {
		const startedAt = Date.now()
		let firstTokenAt

		/**
		 * 累积 OpenAI 兼容 logprobs，并维护基础性能指标。
		 * @param {any} choice - 响应中的 choice 对象。
		 */
		const appendLogprobsFromChoice = (choice) => {
			if (!requestConfig.model_arguments?.logprobs) return
			const contentLogprobs = choice?.logprobs?.content ?? []
			if (!contentLogprobs.length) return

			result.extension ??= {}
			result.extension.logprobs ??= { content: [] }
			result.extension.logprobs.content.push(...contentLogprobs)

			if (!firstTokenAt) firstTokenAt = Date.now()
			const timeSeconds = Math.max(0, (Date.now() - startedAt) / 1000)
			const tokensCount = result.extension.logprobs.content.length
			const speed = timeSeconds > 0 ? tokensCount / timeSeconds : 0

			result.extension.logprobs_metrics = {
				ttftSeconds: Math.max(0, (firstTokenAt - startedAt) / 1000),
				timeSeconds,
				tokensCount,
				speed,
			}
		}

		let imageIndex = 0
		const response = await fetch(requestConfig.url, {
			method: 'POST',
			headers: requestHeaders(requestConfig),
			body: JSON.stringify({
				model: requestConfig.model,
				messages,
				stream: requestConfig.use_stream,
				...requestConfig.model_arguments,
			}),
			signal
		})

		if (!response.ok) {
			let errorPayload
			try {
				const text = await response.text()
				try {
					errorPayload = { data: JSON.parse(text), response }
				} catch {
					errorPayload = { text, response }
				}
			} catch {
				errorPayload = response
			}
			throw errorPayload
		}

		const reader = response.body.getReader()
		signal?.addEventListener?.('abort', () => {
			const err = new Error('User Aborted')
			err.name = 'AbortError'
			reader.cancel(err).catch(() => { })
		}, { once: true })

		const decoder = new TextDecoder()
		let buffer = ''
		let isSSE = false

		const imageProcessingPromises = []

		/**
		 * 处理图片 URL 数组
		 * @param {string[]} imageUrls - 图片 URL 数组。
		 */
		const processImages = (imageUrls) => {
			if (!imageUrls || !Array.isArray(imageUrls)) return

			const promise = (async () => {
				const newFiles = await Promise.all(imageUrls.map(async (url) => {
					try {
						const imageResponse = await fetch(url)
						if (!imageResponse.ok) return null
						return {
							name: `image${imageIndex++}.png`,
							buffer: await imageResponse.arrayBuffer(),
							mimetype: 'image/png'
						}
					} catch (error) {
						console.error('Failed to fetch image:', url, error)
						return null
					}
				}))

				const validFiles = newFiles.filter(Boolean)
				if (validFiles.length > 0) {
					result.files.push(...validFiles)
					previewUpdater(result)
				}
			})()
			imageProcessingPromises.push(promise)
		}

		try {
			while (true) {
				if (signal?.aborted) {
					const err = new Error('User Aborted')
					err.name = 'AbortError'
					throw err
				}
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })

				if (!isSSE && /^data:/m.test(buffer))
					isSSE = true

				if (isSSE) {
					const lines = buffer.split('\n')
					buffer = lines.pop()

					for (const line of lines) {
						const trimmed = line.trim()
						if (!trimmed.startsWith('data:')) continue

						const data = trimmed.slice(5).trim()
						if (data === '[DONE]') continue

						try {
							const json = JSON.parse(data)
							const delta = json.choices?.[0]?.delta
							const message = json.choices?.[0]?.message

							const content = delta?.content || message?.content || ''
							if (content)
								result.content += content

							appendLogprobsFromChoice(json.choices?.[0])

							// 提取 reasoning_content（DeepSeek / reasoning models，Chat Completions 格式）
							const reasoningChunk = delta?.reasoning_content ?? message?.reasoning_content ?? ''
							if (reasoningChunk) {
								result.extension ??= {}
								result.extension.reasoning_content = (result.extension.reasoning_content ?? '') + reasoningChunk
							}

							// 提取 OpenAI Responses API 流式 reasoning summary delta
							if (json.type === 'response.reasoning_summary_text.delta') {
								result.extension ??= {}
								result.extension.reasoning_summary ??= []
								const idx = json.content_index ?? 0
								while (result.extension.reasoning_summary.length <= idx)
									result.extension.reasoning_summary.push('')
								result.extension.reasoning_summary[idx] += json.delta ?? ''
							}

							if (content || reasoningChunk || json.type === 'response.reasoning_summary_text.delta')
								previewUpdater(result)

							const images = delta?.images || message?.images
							if (images) processImages(images)
						} catch (error) {
							console.warn('Error parsing stream data:', error)
						}
					}
				}
			}

			if (!isSSE && buffer.trim()) try {
				const json = JSON.parse(buffer)
				const message = json.choices?.[0]?.message
				appendLogprobsFromChoice(json.choices?.[0])
				if (message) {
					result.content = message.content || ''
					if (message.images) processImages(message.images)
					// 提取 reasoning_content（DeepSeek / reasoning models）
					if (message.reasoning_content) {
						result.extension ??= {}
						result.extension.reasoning_content = message.reasoning_content
					}
				}
				// 提取 OpenAI Responses API 非流式格式（output 数组）
				if (json.output) for (const item of json.output) {
					if (item.type === 'reasoning') {
						result.extension ??= {}
						result.extension.reasoning_summary ??= []
						for (const s of item.summary ?? [])
							if (s.type === 'summary_text' && s.text)
								result.extension.reasoning_summary.push(s.text)
					}
					if (item.type === 'message' && !result.content)
						for (const c of item.content ?? [])
							if (c.type === 'output_text') result.content += c.text ?? ''
				}
			} catch (error) {
				if (!result.content) console.error('Failed to parse response as JSON:', error)
			}
		} catch (error) {
			if (error.name === 'AbortError') throw error
			console.error('Stream reading error:', error)
			throw error
		} finally {
			reader.releaseLock()
		}

		if (imageProcessingPromises.length > 0)
			await Promise.allSettled(imageProcessingPromises)

		return result
	}

	/**
	 * 按单次候选（URL + API 风格）请求并解析。
	 * @param {Array<object>} messages - 消息数组。
	 * @param {{url: string, apiStyle: 'chat' | 'responses'}} candidate - 候选请求。
	 * @param {object} options - 选项。
	 * @returns {Promise<object>} 模型返回的内容。
	 */
	async function fetchByCandidate(messages, candidate, options) {
		if (candidate.apiStyle !== 'responses')
			return fetchChatCompletion(messages, { ...config, url: candidate.url }, options)

		const requestConfig = { ...config, url: candidate.url }
		return fetchResponses({
			url: candidate.url,
			headers: requestHeaders(requestConfig),
			body: messagesToResponsesBody(messages, {
				model: config.model,
				stream: config.use_stream,
				model_arguments: toResponsesArguments(config.model_arguments),
			}),
			signal: options.signal,
			previewUpdater: options.previewUpdater,
			result: options.result,
		})
	}

	/**
	 * 调用基础模型（按候选顺序回退）。
	 * @param {Array<object>} messages - 消息数组。
	 * @param {{ signal?: AbortSignal, previewUpdater?: (result: {content: string, content_for_show?: string, files: any[]}) => void, result?: {content: string, content_for_show?: string, files: any[]} }} options - 选项。
	 * @returns {Promise<{content: string, content_for_show?: string, files: any[]}>} 模型返回的内容。
	 */
	return async function fetchChatCompletionWithRetry(messages, options = {}) {
		const errors = []

		for (const candidate of requestCandidates(config))
			try {
				const result = await fetchByCandidate(messages, candidate, options)

				const changedUrl = candidate.url !== config.url
				if (changedUrl) {
					console.warn(`the api endpoint of ${config.model} resolved to ${candidate.apiStyle} ${candidate.url}`)
					config.url = candidate.url
					SaveConfig()
				}

				return result
			} catch (error) {
				if (error.name === 'AbortError') throw error
				errors.push(error)
			}

		throw errors.length == 1 ? errors[0] : errors
	}
}

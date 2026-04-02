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
			headers: {
				'Content-Type': 'application/json',
				...requestConfig.apikey ? { Authorization: 'Bearer ' + requestConfig.apikey } : {},
				'HTTP-Referer': 'https://steve02081504.github.io/fount/',
				'X-Title': 'fount',
				...requestConfig.url.includes('openrouter.ai') ? {
					'X-OpenRouter-Title': 'fount',
					'X-OpenRouter-Categories': 'personal-agent,productivity,roleplay',
				} : {},
				...requestConfig.custom_headers
			},
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
			// eslint-disable-next-line no-constant-condition
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
	 * 调用基础模型（带重试）。
	 * @param {Array<object>} messages - 消息数组。
	 * @param {{ signal?: AbortSignal, previewUpdater?: (result: {content: string, content_for_show?: string, files: any[]}) => void, result?: {content: string, content_for_show?: string, files: any[]} }} options - 选项。
	 * @returns {Promise<{content: string, content_for_show?: string, files: any[]}>} 模型返回的内容。
	 */
	return async function fetchChatCompletionWithRetry(messages, options = {}) {
		const errors = []
		let retryConfigs = [
			{},
			{ urlSuffix: '/v1/chat/completions' },
			{ urlSuffix: '/chat/completions' },
		]
		if (config.url.endsWith('/chat/completions'))
			retryConfigs = retryConfigs.filter(retry => !retry?.urlSuffix?.endsWith?.('/chat/completions'))

		for (const retryConfig of retryConfigs) {
			const currentConfig = { ...config }
			if (retryConfig.urlSuffix) currentConfig.url += retryConfig.urlSuffix

			try {
				const result = await fetchChatCompletion(messages, currentConfig, options)

				if (retryConfig.urlSuffix) {
					console.warn(`the api url of ${config.model} need to change from ${config.url} to ${currentConfig.url}`)
					Object.assign(config, currentConfig)
					SaveConfig()
				}

				return result
			} catch (error) {
				if (error.name === 'AbortError') throw error
				errors.push(error)
			}
		}
		throw errors.length == 1 ? errors[0] : errors
	}
}

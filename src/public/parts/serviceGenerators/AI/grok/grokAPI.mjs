// grokAPI.mjs
import axios from 'npm:axios'

/**
 * 获取标准请求头。
 * @param {string} cookie - Cookie。
 * @returns {object} 标准请求头。
 */
const getStandardHeaders = cookie => {
	return {
		accept: '*/*',
		'accept-encoding': 'gzip, deflate',
		'accept-language': 'en-US,en;q=0.9',
		'content-type': 'application/json',
		cookie,
		dnt: '1',
		origin: 'https://grok.com',
		referer: 'https://grok.com/',
		'sec-ch-ua': '"Not(A:Brand";v="99", "Chromium";v="122", "Google Chrome";v="122"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"',
		'sec-fetch-dest': 'empty',
		'sec-fetch-mode': 'cors',
		'sec-fetch-site': 'same-origin',
		'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
	}
}

const MIME_TYPE_EXTENSIONS = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/bmp': 'bmp',
	'image/svg+xml': 'svg'
}

/**
 * GrokAPI 类，用于与 Grok API 进行交互。
 */
export class GrokAPI {
	/**
	 * 创建 GrokAPI 的实例。
	 * @param {object} config - 配置对象。
	 */
	constructor(config) {
		this.config = config
		// cookies 现在直接是数组
		this.cookies = config.cookies || []
		this.currentCookieIndex = 0
		this.lastSuccessfulCookieIndex = 0
		this.currentThinkCookieIndex = 0
		this.lastSuccessfulThinkCookieIndex = 0
		this.mutex = new Map()  // 用于Cookie选择的互斥锁
		this.tokenCounts = {} //用于存储每个消息的token数量
	}

	/**
	 * 获取锁。
	 * @returns {Promise<void>}
	 */
	async acquireLock() {
		while (this.mutex.get('cookie'))
			await new Promise(resolve => setTimeout(resolve, 100))

		this.mutex.set('cookie', true)
	}

	/**
	 * 释放锁。
	 * @returns {void}
	 */
	releaseLock() {
		this.mutex.delete('cookie')
	}

	/**
	 * 获取下一个 Cookie。
	 * @param {boolean} useLastSuccessful - 是否使用上一个成功的 Cookie。
	 * @param {boolean} isThinkModel - 是否是思考模型。
	 * @returns {Promise<string>} 下一个 Cookie。
	 */
	async getNextCookie(useLastSuccessful = true, isThinkModel = false) {
		if (!this.cookies.length) return ''

		try {
			await this.acquireLock()
			let selectedIndex

			if (this.cookies.length === 1)
				selectedIndex = 0
			else
				if (useLastSuccessful)
					selectedIndex = isThinkModel ? this.lastSuccessfulThinkCookieIndex : this.lastSuccessfulCookieIndex
				else {
					const currentIndex = isThinkModel ? this.currentThinkCookieIndex : this.currentCookieIndex
					selectedIndex = currentIndex % this.cookies.length
					if (isThinkModel)
						this.currentThinkCookieIndex = selectedIndex
					else
						this.currentCookieIndex = selectedIndex
				}

			// 直接使用 this.cookies[selectedIndex]，不再需要拼接 "sso="
			return `sso=${this.cookies[selectedIndex]}`
		}
		finally {
			this.releaseLock()
		}
	}

	/**
	 * 检查配额。
	 * @param {string} cookie - Cookie。
	 * @param {boolean} isThinkModel - 是否是思考模型。
	 * @returns {Promise<object|null>} 配额信息。
	 */
	async checkQuota(cookie, isThinkModel = false) {
		try {
			const headers = getStandardHeaders(`sso=${cookie}`)
			const response = await axios.post(
				'https://grok.com/rest/rate-limits',
				{
					requestKind: isThinkModel ? 'REASONING' : 'DEFAULT',
					modelName: 'grok-3'
				},
				{ headers }
			)
			return response.data
		}
		catch (error) {
			console.error(`Failed to check quota for cookie: ${error.message}`)
			return null
		}
	}

	/**
	 * 检查当前 Cookie 的配额。
	 * @param {string} cookie - Cookie。
	 * @param {boolean} isThinkModel - 是否是思考模型。
	 * @returns {Promise<void>}
	 */
	async checkCurrentCookieQuota(cookie, isThinkModel = false) {
		if (cookie) try {
			const cookieValue = cookie.replace('sso=', '')
			const quota = await this.checkQuota(cookieValue, isThinkModel)
			if (quota) {
				const cookieIndex = isThinkModel ? this.currentThinkCookieIndex : this.currentCookieIndex
				const modelType = isThinkModel ? 'Think' : 'Default'
				console.log(`[${new Date().toISOString()}] ${modelType} Cookie #${cookieIndex + 1} 剩余额度: ${quota.remainingQueries}`)
				if (quota.remainingQueries <= 0) {
					if (isThinkModel)
						this.currentThinkCookieIndex++
					else
						this.currentCookieIndex++

					console.log(`[${new Date().toISOString()}] ${modelType} Cookie #${cookieIndex + 1} 额度已用尽，下次请求将切换到 Cookie #${(isThinkModel ? this.currentThinkCookieIndex : this.currentCookieIndex) % this.cookies.length + 1}`)
				}
			}
		} catch (error) {
			console.error(`[${new Date().toISOString()}] 检查额度时出错:`, error)
		}
	}

	/**
	 * 将文件上传到 Grok。
	 * @param {string} base64Content - Base64 编码的文件内容。
	 * @param {string} fileName - 文件名。
	 * @param {string} mimeType - MIME 类型。
	 * @param {string} cookie - Cookie。
	 * @returns {Promise<string>} 文件元数据 ID。
	 */
	async uploadFileToGrok(base64Content, fileName, mimeType, cookie) {
		try {
			const headers = getStandardHeaders(cookie)
			const payload = {
				fileName,
				fileMimeType: mimeType,
				content: base64Content
			}
			const response = await axios.post(
				'https://grok.com/rest/app-chat/upload-file',
				payload,
				{ headers }
			)
			return response.data.fileMetadataId
		}
		catch (error) {
			console.error('File upload error:', error)
			throw error
		}
	}

	/**
	 * 从消息中提取文件。
	 * @param {object} message - 消息对象。
	 * @param {string} cookie - Cookie。
	 * @returns {Promise<Array<object>>} 文件 ID 数组。
	 */
	async extractFilesFromMessage(message, cookie) {
		const fileIds = []
		let { content } = message

		if (!Array.isArray(content))
			content = [{ type: 'text', text: content }]


		for (const item of content)
			if (item.type === 'image_url') {
				let base64Content = ''
				let mimeType = ''
				let fileName = ''
				const imageUrl = Object(item.image_url) instanceof String
					? item.image_url
					: item.image_url?.url

				if (imageUrl?.startsWith('data:')) {
					const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/)
					if (matches) {
						mimeType = matches[1]
						base64Content = matches[2]
						const extension = MIME_TYPE_EXTENSIONS[mimeType] || 'jpg'
						fileName = `image_${Date.now()}.${extension}`

						try {
							const fileId = await this.uploadFileToGrok(base64Content, fileName, mimeType, cookie)
							fileIds.push({ id: fileId, fileName })
						}
						catch (error) {
							console.error(`Failed to upload image ${fileName}:`, error)
						}
					}
				}
			}

		return fileIds
	}

	/**
	 * 将 OpenAI 请求转换为 Grok 格式。
	 * @param {object} openaiRequest - OpenAI 请求。
	 * @returns {Promise<object>} Grok 请求负载。
	 */
	async convertToGrokFormat(openaiRequest) {
		let messageText = ''
		const allFileIds = []
		const cookie = await this.getNextCookie(true, false)

		for (const message of openaiRequest.messages)
			if (Array.isArray(message.content)) {
				const textContent = message.content
					.filter(content => content.type === 'text')
					.map(content => content.text)
					.join('\n')

				const hasImages = message.content.some(content =>
					content.type === 'image_url' && (
						(Object(content.image_url) instanceof String && content.image_url.startsWith('data:')) ||
						content.image_url?.url?.startsWith('data:')
					)
				)

				if (hasImages) {
					const fileResults = await this.extractFilesFromMessage(message, cookie)
					allFileIds.push(...fileResults.map(f => f.id))
					const imageNames = fileResults.map(f => f.fileName).join(', ')
					messageText += `${message.role}: ${textContent}\n[Attached images: ${imageNames}]\n`
				}
				else messageText += `${message.role}: ${textContent}\n`
			}
			else messageText += `${message.role}: ${message.content}\n`



		const isThinkModel = openaiRequest.model === 'grok-3-think'
		const isSearchModel = openaiRequest.model === 'grok-3-search'

		const disableSearch = !isSearchModel
		const toolOverrides = isSearchModel ? {} : {
			imageGen: false,
			webSearch: false,
			xSearch: false,
			xMediaSearch: false,
			trendsSearch: false,
			xPostAnalyze: false
		}

		return {
			temporary: true,
			modelName: 'grok-3',
			message: messageText.trim(),
			fileAttachments: allFileIds,
			imageAttachments: [],
			disableSearch,
			enableImageGeneration: true,
			returnImageBytes: false,
			returnRawGrokInXaiRequest: false,
			enableImageStreaming: !!openaiRequest.stream,
			imageGenerationCount: 2,
			forceConcise: false,
			toolOverrides,
			enableSideBySide: true,
			isPreset: false,
			sendFinalMetadata: true,
			customInstructions: '',
			deepsearchPreset: '',
			isReasoning: isThinkModel,
		}
	}
	/**
	 * 发出 Grok 请求。
	 * @param {object} grokPayload - Grok 请求负载。
	 * @param {boolean} isStream - 是否是流式请求。
	 * @param {number} startIndex - 起始索引。
	 * @param {boolean} isThinkModel - 是否是思考模型。
	 * @returns {Promise<import('axios').AxiosResponse>} Axios 响应。
	 */
	async makeGrokRequest(grokPayload, isStream, startIndex = 0, isThinkModel = false) {
		if (isThinkModel)
			this.currentThinkCookieIndex = startIndex
		else
			this.currentCookieIndex = startIndex

		for (let i = 0; i < this.cookies.length; i++) try {
			const cookie = await this.getNextCookie(false, isThinkModel)
			const headers = getStandardHeaders(cookie)
			const response = await axios.post(
				'https://grok.com/rest/app-chat/conversations/new',
				grokPayload,
				{ headers, responseType: 'stream' }
			)
			const currentCookie = cookie.replace('sso=', '')
			const index = this.cookies.findIndex(c => c === currentCookie)
			if (isThinkModel)
				this.lastSuccessfulThinkCookieIndex = index
			else
				this.lastSuccessfulCookieIndex = index

			return response
		} catch (error) {
			const isLastCookie = i === this.cookies.length - 1
			if (error.response && [429, 401, 403].includes(error.response.status)) {
				console.log(`Cookie ${i + 1} 失败，状态码: ${error.response.status}`)
				if (isLastCookie) {
					console.log('已到达最后一个Cookie，重新从第1个开始尝试')
					if (isThinkModel)
						this.currentThinkCookieIndex = 0
					else
						this.currentCookieIndex = 0

					continue
				}
				if (isThinkModel)
					this.currentThinkCookieIndex++
				else
					this.currentCookieIndex++

				continue
			}
			throw error
		}

		throw new Error('All cookies have been tried and failed')
	}
	/**
	 * 调用 API。
	 * @param {Array<object>} messages - 消息数组。
	 * @param {string} model - 模型名称。
	 * @param {boolean} stream - 是否是流式请求。
	 * @param {(delta: string) => void} [onDelta] - 每个增量块的回调函数 (仅限流式)。
	 * @param {AbortSignal} [signal] - 用于中止请求的 AbortSignal (仅限流式)。
	 * @returns {Promise<string>} 响应文本。
	 */
	async call(messages, model, stream = false, onDelta = null, signal = null) {
		const isThinkModel = model === 'grok-3-think'
		const openaiRequest = { messages, model, stream }
		const grokPayload = await this.convertToGrokFormat(openaiRequest)
		const response = await this.makeGrokRequest(grokPayload, stream, 0, isThinkModel)
		if (stream)
			return this.processStream(response, model, onDelta, signal)

		else
			return this.handleNonStreamResponse(response, isThinkModel)
	}
	/**
	 * 处理流式响应。
	 * @param {import('axios').AxiosResponse} response - Axios 响应。
	 * @param {string} model - 模型名称。
	 * @param {(delta: string) => void} [onDelta] - 每个增量块的可选回调函数。
	 * @param {AbortSignal} [signal] - 用于中止请求的 AbortSignal。
	 * @returns {Promise<string>} 完整的响应文本。
	 */
	async processStream(response, model, onDelta, signal) {
		const isThinkModel = model === 'grok-3-think'

		return new Promise((resolve, reject) => {
			let buffer = ''
			let fullContent = ''
			let thinkingBlockActive = false

			/**
			 * 处理数据块
			 * @param {Buffer} chunk - 数据块
			 */
			const handleData = (chunk) => {
				if (signal?.aborted) {
					response.data.destroy()
					const err = new Error('Aborted by user')
					err.name = 'AbortError'
					reject(err)
					return
				}

				buffer += chunk.toString()
				while (true) {
					const newlineIndex = buffer.indexOf('\n')
					if (newlineIndex === -1) break
					const line = buffer.slice(0, newlineIndex)
					buffer = buffer.slice(newlineIndex + 1)
					if (!line.trim()) continue

					try {
						if (line.startsWith('{"result":')) {
							const data = JSON.parse(line)
							if (data.result?.response?.token !== undefined) {
								const { token, isThinking } = data.result.response
								let delta = ''
								if (isThinkModel) {
									if (isThinking && !thinkingBlockActive) {
										thinkingBlockActive = true
										delta += '\n<think>\n'
									}
									if (!isThinking && thinkingBlockActive) {
										delta += '\n</think>\n'
										thinkingBlockActive = false
									}
								}
								if (token === '' && data.result.response.isSoftStop) continue

								delta += token
								if (delta) {
									fullContent += delta
									if (onDelta) onDelta(delta)
								}
							}
							if (data.result?.response?.finalMetadata)
								if (isThinkModel && thinkingBlockActive) {
									const delta = '\n</think>\n'
									fullContent += delta
									if (onDelta) onDelta(delta)
									thinkingBlockActive = false
								}
						}
					} catch (e) {
						console.warn('Incomplete or invalid JSON, skipping chunk', e)
					}
				}
			}

			/**
			 * 清理并解析
			 */
			const cleanup = async () => {
				if (thinkingBlockActive) {
					const delta = '\n</think>\n'
					fullContent += delta
					if (onDelta) onDelta(delta)
				}
				const cookie = await this.getNextCookie(true, isThinkModel)
				await this.checkCurrentCookieQuota(cookie, isThinkModel)
				resolve(fullContent)
			}

			response.data.on('data', handleData)
			response.data.on('end', cleanup)
			response.data.on('error', reject)

			if (signal)
				signal.addEventListener('abort', () => {
					response.data.destroy()
					reject(new Error('Aborted by user'))
				})
		})
	}
	/**
	 * 处理非流式响应。
	 * @param {import('axios').AxiosResponse} response - Axios 响应。
	 * @param {boolean} isThinkModel - 是否是思考模型。
	 * @returns {Promise<string>} 响应文本。
	 */
	async handleNonStreamResponse(response, isThinkModel) {
		let fullResponse = ''
		let buffer = ''
		for await (const chunk of response.data) {
			buffer += chunk.toString()
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''

			for (const line of lines) if (line.trim()) try {
				if (line.startsWith('{"result":')) {
					const data = JSON.parse(line)
					if (data.result?.response?.modelResponse?.message)
						fullResponse = data.result.response.modelResponse.message
				}
			} catch {
				console.warn('Failed to parse line in non-stream mode')
			}
		}
		if (buffer.trim()) try {
			const data = JSON.parse(buffer)
			if (data.result?.response?.modelResponse?.message)
				fullResponse = data.result.response.modelResponse.message
		} catch {
			console.warn('Failed to parse final buffer in non-stream mode')
		}

		if (isThinkModel)
			fullResponse = '\n<think>\n' + fullResponse + '\n</think>\n'

		const cookie = await this.getNextCookie(true, isThinkModel)
		await this.checkCurrentCookieQuota(cookie, isThinkModel)
		return fullResponse
	}
	/**
	 * 生成图像。
	 * @param {string} prompt - 提示。
	 * @param {number} n - 生成图像的数量。
	 * @returns {Promise<Array<object>>} 图像 URL 数组。
	 */
	async generateImage(prompt, n = 1) {
		const grokPayload = {
			temporary: true,
			modelName: 'grok-3',
			message: `Please generate the image: ${prompt}`,
			fileAttachments: [],
			imageAttachments: [],
			disableSearch: false,
			enableImageGeneration: true,
			returnImageBytes: false,
			returnRawGrokInXaiRequest: false,
			enableImageStreaming: true,
			imageGenerationCount: n,
			forceConcise: false,
			toolOverrides: {},
			enableSideBySide: true,
			isPreset: false,
			sendFinalMetadata: true,
			customInstructions: '',
			deepsearchPreset: '',
			isReasoning: false
		}
		const response = await this.makeGrokRequest(grokPayload, true, 0)
		return new Promise((resolve, reject) => {
			let generatedImages = []
			let buffer = ''
			response.data.on('data', chunk => {
				buffer += chunk.toString()
				while (true) {
					const newlineIndex = buffer.indexOf('\n')
					if (newlineIndex === -1) break
					const line = buffer.slice(0, newlineIndex)
					buffer = buffer.slice(newlineIndex + 1)
					if (line.trim()) try {
						if (line.startsWith('{"result":')) {
							const data = JSON.parse(line)
							if (data.result?.response?.modelResponse?.generatedImageUrls)
								generatedImages = data.result.response.modelResponse.generatedImageUrls.map(url => ({
									url: `https://assets.grok.com/${url}`,
									revised_prompt: prompt
								}))
						}
					} catch (e) {
						console.warn('Failed to parse JSON:', e)
					}
				}
			})
			response.data.on('end', async () => {
				if (!generatedImages.length) resolve([])
				else resolve(generatedImages)

				const cookie = await this.getNextCookie()
				await this.checkCurrentCookieQuota(cookie)
			})
			response.data.on('error', reject)
		})
	}

	/**
	 * 计算令牌数。
	 * @param {string} text - 文本。
	 * @returns {number} 令牌数。
	 */
	countTokens(text) {
		// 非常粗略的估算，假设平均每个汉字2个token，每个英文单词1.5个token
		const chineseCharCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length
		const englishWordCount = (text.match(/[A-Za-z]+/g) || []).length
		const numberCount = (text.match(/\d+/g) || []).length // 增加对数字的估算
		const otherCharCount = (text.match(/[^\d\sA-Za-z\u4e00-\u9fa5]/g) || []).length // 增加对其他字符的估算

		// 估算token数量（可以根据需要调整系数）
		const estimatedTokens = chineseCharCount * 2 + englishWordCount * 1.5 + numberCount * 1 + otherCharCount * 1

		return Math.ceil(estimatedTokens) // 向上取整
	}
}

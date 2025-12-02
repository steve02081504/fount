import { Buffer } from 'node:buffer'

import { v4 as uuidv4 } from 'npm:uuid'

import { authenticate, getUserByReq } from '../../../../server/auth.mjs'
import { loadAIsource } from '../../../../server/managers/AIsource_manager.mjs'
import { getPartList } from '../../../../server/managers/index.mjs'

/**
 * 处理补全请求。
 * @param {import('npm:express').Request} req - 请求对象。
 * @param {import('npm:express').Response} res - 响应对象。
 * @param {string} username - 用户名。
 * @param {string} model - 模型。
 * @returns {Promise<void>}
 */
async function handleCompletionsRequest(req, res, username, model) {
	const { prompt, max_tokens = 1024, temperature = 0.7, top_p = 1, n = 1, stream = false, stop, presence_penalty = 0, frequency_penalty = 0, logit_bias } = req.body

	if (n > 1)
		return res.status(400).json({ error: { message: 'n > 1 is not supported.', type: 'invalid_request_error', code: 'parameter_not_supported' } })


	const AIsource = await loadAIsource(username, model)
	const promptText = Array.isArray(prompt) ? prompt.join('') : prompt

	const result = await AIsource.Call(promptText)

	const text_result = result.content
	const completionId = `cmpl-${uuidv4()}`
	const createdTimestamp = Math.floor(Date.now() / 1000)

	if (stream) {
		res.setHeader('Content-Type', 'text/event-stream')
		res.setHeader('Cache-Control', 'no-store')
		res.setHeader('Connection', 'keep-alive')
		res.flushHeaders() // Ensure headers are sent immediately

		// Send content chunk
		const contentData = {
			id: completionId,
			object: 'text_completion.chunk',
			created: createdTimestamp,
			model,
			choices: [{
				text: text_result,
				index: 0,
				logprobs: null,
				finish_reason: null, // Not finished in the first chunk for simulation
			}],
		}
		res.write(`data: ${JSON.stringify(contentData)}\n\n`)

		// Send final chunk with finish reason
		const finalData = {
			id: completionId,
			object: 'text_completion.chunk',
			created: createdTimestamp, // or Date.now()/1000 again
			model,
			choices: [{
				text: '', // Often empty in final chunk if content sent before
				index: 0,
				logprobs: null,
				finish_reason: 'stop',
			}],
		}
		res.write(`data: ${JSON.stringify(finalData)}\n\n`)

		// Send DONE signal
		res.write('data: [DONE]\n\n')
		res.end()
	}
	else res.status(200).json({
		id: completionId,
		object: 'text_completion',
		created: createdTimestamp,
		model,
		choices: [{
			text: text_result,
			index: 0,
			logprobs: null,
			finish_reason: 'stop',
		}],
		usage: { // Note: Token counts are still estimates
			prompt_tokens: promptText.length,
			completion_tokens: text_result.length,
			total_tokens: promptText.length + text_result.length,
		},
	})
}

/**
 * 处理聊天补全请求。
 * @param {import('npm:express').Request} req - 请求对象。
 * @param {import('npm:express').Response} res - 响应对象。
 * @param {string} username - 用户名。
 * @param {string} model - 模型。
 * @returns {Promise<void>}
 */
async function handleChatCompletionsRequest(req, res, username, model) {
	const { messages, max_tokens = 1024, temperature = 0.7, top_p = 1, n = 1, stream = false, stop, presence_penalty = 0, frequency_penalty = 0, logit_bias } = req.body

	if (n > 1)
		return res.status(400).json({ error: { message: 'n > 1 is not supported.', type: 'invalid_request_error', code: 'parameter_not_supported' } })

	if (!messages || !Array.isArray(messages) || !messages.length)
		return res.status(400).json({ error: { message: '\'messages\' is required and must be a non-empty array.', type: 'invalid_request_error', code: 'parameter_missing_or_invalid' } })

	/**
	 * 解析 OpenAI 格式的消息内容，提取文本和文件
	 * @param {string | object[]} parts - OpenAI 格式的消息内容
	 * @returns {{content: string, files: any[]}} 解析后的文本和文件
	 */
	const parseMessageContent = async (parts) => {
		if (Object(parts) instanceof String) return { content: parts, files: [] }

		let content = ''
		const files = []

		if (Array.isArray(parts)) for (const part of parts)
			if (part.type === 'text') content += part.text || ''
			else if (part.type === 'image_url') {
				const url = part.image_url?.url || part.image_url
				if (url) try {
					const response = await fetch(url)
					const buffer = await response.arrayBuffer()
					const contentType = response.headers.get('content-type') || 'image/png'
					files.push({
						mime_type: contentType,
						buffer: Buffer.from(buffer),
						name: `image_${files.length}.${contentType.split('/')[1] || 'png'}`
					})
				} catch (e) {
					console.error('Failed to fetch image:', url, e)
				}
			}
			else if (part.type === 'input_audio') {
				const audioData = part.input_audio?.data
				const format = part.input_audio?.format || 'wav'
				if (audioData) {
					const mimeMap = {
						wav: 'audio/wav',
						mp3: 'audio/mpeg',
						mp4: 'audio/mp4',
						m4a: 'audio/m4a',
						webm: 'audio/webm',
						pcm: 'audio/pcm',
					}
					files.push({
						mime_type: mimeMap[format] || 'audio/wav',
						buffer: Buffer.from(audioData, 'base64'),
						name: `audio_${files.length}.${format}`
					})
				}
			}
		return { content, files }
	}

	const AIsource = await loadAIsource(username, model)
	const fountMessages = await Promise.all(messages.map(async message => ({
		role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'char' : 'system',
		...await parseMessageContent(message.content)
	})))

	const promptStruct = {
		chat_log: fountMessages,
		char_prompt: { text: [] },
		user_prompt: { text: [] },
		world_prompt: { text: [] },
		other_chars_prompt: {},
		plugin_prompts: {},
	}

	const chatId = `chatcmpl-${uuidv4()}`
	const createdTimestamp = Math.floor(Date.now() / 1000)

	if (stream) {
		res.setHeader('Content-Type', 'text/event-stream')
		res.setHeader('Cache-Control', 'no-store')
		res.setHeader('Connection', 'keep-alive')
		res.setHeader('X-Accel-Buffering', 'no')
		res.flushHeaders()

		let lastContent = ''
		let sentRole = false
		let sentFiles = []

		/**
		 * 处理 AI 响应的进度更新。
		 * @param {{content: string, files: any[]}} result - 包含内容和文件的结果对象。
		 * @returns {void}
		 */
		const replyPreviewUpdater = (result) => {
			const contentDelta = result.content.substring(lastContent.length)
			lastContent = result.content

			// 处理新生成的文件
			const newFiles = result.files?.slice(sentFiles.length) || []
			if (newFiles.length) {
				sentFiles = result.files
				for (const file of newFiles)
					// 忽略视频和其他文件，只处理音频和图片
					if (file.mime_type.startsWith('audio/')) {
						// 音频格式: { type: 'audio', audio: { data: '...', format: '...' } }
						// 映射 MIME 到 OpenAI 格式
						const formatMap = {
							'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav',
							'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
							'audio/mp4': 'mp4', 'audio/m4a': 'm4a',
							'audio/webm': 'webm', 'audio/ogg': 'webm',
							'audio/pcm': 'pcm',
						}
						const format = formatMap[file.mime_type.toLowerCase()] || 'wav'

						// 在流式传输中，通常通过 delta 发送
						// 注意：OpenAI 流式音频通常使用 modalites: ['text', 'audio'] 并在 delta 中包含 audio 字段
						// 这里我们模拟这种行为
						const chunkData = {
							id: chatId,
							object: 'chat.completion.chunk',
							created: createdTimestamp,
							model,
							choices: [{
								index: 0,
								delta: {
									audio: {
										id: `audio_${uuidv4()}`, // 音频块通常有 ID
										data: file.buffer.toString('base64'),
										format
									}
								},
								finish_reason: null
							}]
						}
						res.write(`data: ${JSON.stringify(chunkData)}\n\n`)
					} else if (file.mime_type.startsWith('image/')) {
						// 图片格式：虽然 Chat Completions 流式不常用图片输出，但我们可以尝试发送
						// 或者使用 image_url 结构
						const chunkData = {
							id: chatId,
							object: 'chat.completion.chunk',
							created: createdTimestamp,
							model,
							choices: [{
								index: 0,
								delta: {
									// 自定义扩展或尝试模拟 content part
									content: [
										{
											type: 'image_url',
											image_url: {
												url: `data:${file.mime_type};base64,${file.buffer.toString('base64')}`
											}
										}
									]
								},
								finish_reason: null
							}]
						}
						// 注意：标准的 delta.content 通常是字符串。发送数组可能不兼容某些客户端。
						// 但为了传出图片，这是最接近多模态 content 的方式。
						// 如果客户端只期望字符串，这可能会报错。
						// 另一种方式是使用自定义字段，但用户要求按 OpenAI 格式。
						// 鉴于 OpenAI 目前主要在 Message 中支持多模态 Content，而在 Delta 中支持较少（除了 Audio），
						// 我们这里尽量保持结构化。
						res.write(`data: ${JSON.stringify(chunkData)}\n\n`)
					}
			}

			if (contentDelta) {
				const delta = { content: contentDelta }
				if (!sentRole) {
					delta.role = 'assistant'
					sentRole = true
				}
				const chunkData = {
					id: chatId,
					object: 'chat.completion.chunk',
					created: createdTimestamp,
					model,
					choices: [{
						index: 0,
						delta,
						finish_reason: null
					}]
				}
				res.write(`data: ${JSON.stringify(chunkData)}\n\n`)
			}
		}

		try {
			await AIsource.StructCall(promptStruct, { replyPreviewUpdater, signal: req.signal })

			// Send final chunk
			const finalChunkData = {
				id: chatId,
				object: 'chat.completion.chunk',
				created: createdTimestamp,
				model,
				choices: [{
					index: 0,
					delta: {},
					finish_reason: 'stop'
				}]
			}
			res.write(`data: ${JSON.stringify(finalChunkData)}\n\n`)
			res.write('data: [DONE]\n\n')
		} catch (error) {
			if (error.name !== 'AbortError')
				console.error('Error during streaming StructCall:', error)
		} finally {
			res.end()
		}
	}
	else {
		const result = await AIsource.StructCall(promptStruct)
		const text_result = result.content

		// 构建多模态 content 数组
		const contentParts = []
		if (text_result) contentParts.push({ type: 'text', text: text_result })

		if (result.files?.length) for (const file of result.files)
			if (file.mime_type.startsWith('audio/')) {
				const formatMap = {
					'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav',
					'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
					'audio/mp4': 'mp4', 'audio/m4a': 'm4a',
					'audio/webm': 'webm', 'audio/ogg': 'webm',
					'audio/pcm': 'pcm',
				}
				const format = formatMap[file.mime_type.toLowerCase()] || 'wav'
				contentParts.push({
					type: 'audio',
					audio: {
						data: file.buffer.toString('base64'),
						format
					}
				})
			} else if (file.mime_type.startsWith('image/'))
				contentParts.push({
					type: 'image_url',
					image_url: {
						url: `data:${file.mime_type};base64,${file.buffer.toString('base64')}`
					}
				})
			// 忽略其他文件类型

		// 如果没有文件，content 可以直接是字符串（兼容旧客户端），也可以是数组
		// 为了最大兼容性，如果只有文本且没有文件，返回字符串
		const finalContent = contentParts.length === 1 && contentParts[0].type === 'text'
			? contentParts[0].text
			: contentParts

		res.status(200).json({
			id: chatId,
			object: 'chat.completion',
			created: createdTimestamp,
			model,
			choices: [{
				index: 0,
				message: {
					role: 'assistant',
					content: finalContent,
				},
				finish_reason: 'stop',
			}],
			usage: { // Note: Token counts are placeholders
				prompt_tokens: 0,
				completion_tokens: 0,
				total_tokens: 0,
			},
		})
	}
}


/**
 * 设置OpenAI API端点。
 * @param {import('npm:express').Router} router - 路由。
 */
export function setOpenAIAPIEndpoints(router) {
	const basePath = '/api/shells/proxy/calling/openai'

	// 1. 模型列表 (Models List) - Remains the same
	router.get(basePath + '/v1/models', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const modelList = await getPartList(username, 'AIsources')
			const formattedModels = {
				object: 'list',
				data: modelList.map(model => ({
					id: model,
					object: 'model',
					created: Math.floor(Date.now() / 1000),
					owned_by: username,
				})),
			}
			res.status(200).json(formattedModels)
		}
		catch (error) {
			console.error('Error fetching models:', error)
			// Differentiate auth errors from other errors if possible based on getUserByReq
			if (error.message === 'Unauthorized' || error.status === 401)
				return res.status(401).json({ error: { message: 'Authentication failed.', type: 'invalid_request_error', code: 'authentication_error' } })

			res.status(500).json({ error: { message: 'Failed to retrieve model list.', type: 'api_error', code: 'internal_server_error' } })
		}
	})

	/**
	 * 处理补全。
	 * @param {import('npm:express').Request} req - 请求对象。
	 * @param {import('npm:express').Response} res - 响应对象。
	 * @returns {Promise<void>}
	 */
	const processCompletions = async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			// Determine model: check path param first, then body
			const model = req.params.modelname || req.body.model

			if (!model)
				return res.status(400).json({ error: { message: 'Model name not specified in path or request body.', type: 'invalid_request_error', code: 'parameter_missing' } })

			// Call the core logic function
			await handleCompletionsRequest(req, res, username, model)
		}
		catch (error) {
			console.error('Error processing completions request:', error)
			// Differentiate auth errors from other errors if possible
			if (error.message === 'Unauthorized' || error.status === 401)
				return res.status(401).json({ error: { message: 'Authentication failed.', type: 'invalid_request_error', code: 'authentication_error' } })

			res.status(500).json({ error: { message: 'An internal server error occurred.', type: 'api_error', code: 'internal_server_error' } })
		}
	}

	/**
	 * 处理聊天补全。
	 * @param {import('npm:express').Request} req - 请求对象。
	 * @param {import('npm:express').Response} res - 响应对象。
	 * @returns {Promise<void>}
	 */
	const processChatCompletions = async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			// Determine model: check path param first, then body
			const model = req.params.modelname || req.body.model

			if (!model)
				return res.status(400).json({ error: { message: 'Model name not specified in path or request body.', type: 'invalid_request_error', code: 'parameter_missing' } })


			// Call the core logic function
			await handleChatCompletionsRequest(req, res, username, model)
		}
		catch (error) {
			console.error('Error processing chat completions request:', error)
			// Differentiate auth errors from other errors if possible
			if (error.message === 'Unauthorized' || error.status === 401)
				return res.status(401).json({ error: { message: 'Authentication failed.', type: 'invalid_request_error', code: 'authentication_error' } })

			res.status(500).json({ error: { message: 'An internal server error occurred.', type: 'api_error', code: 'internal_server_error' } })
		}
	}

	// 2. 补全 (Completions) - Register both routes
	router.post(basePath + '/v1/completions', authenticate, processCompletions)
	router.post(basePath + '/models/:modelname/v1/completions', authenticate, processCompletions) // New route

	// 3. 聊天补全 (Chat Completions) - Register both routes
	router.post(basePath + '/v1/chat/completions', authenticate, processChatCompletions)
	router.post(basePath + '/models/:modelname/v1/chat/completions', authenticate, processChatCompletions) // New route
}

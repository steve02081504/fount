import { v4 as uuidv4 } from 'npm:uuid'

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { getPartList, loadPart } from '../../../../../server/parts_loader.mjs'

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


	const AIsource = await loadPart(username, 'serviceSources/AI/' + model)
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


	const AIsource = await loadPart(username, 'serviceSources/AI/' + model)
	const fountMessages = messages.map(message => ({
		role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'char' : 'system', // Default to system if unknown? Consider erroring.
		content: message.content
	}))

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
		res.flushHeaders()

		let lastContent = ''
		let sentRole = false
		/**
		 * 处理 AI 响应的进度更新。
		 * @param {{content: string, files: any[]}} result - 包含内容和文件的结果对象。
		 * @returns {void}
		 */
		const replyPreviewUpdater = (result) => {
			const contentDelta = result.content.substring(lastContent.length)
			lastContent = result.content

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
			// It's hard to send an error once the stream has started.
			// We can try to send an error in the stream format if possible, but for now, just closing is fine.
		} finally {
			res.end()
		}
	}
	else {
		const result = await AIsource.StructCall(promptStruct)
		const text_result = result.content
		res.status(200).json({
			id: chatId,
			object: 'chat.completion',
			created: createdTimestamp,
			model,
			choices: [{
				index: 0,
				message: {
					role: 'assistant',
					content: text_result,
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
	const basePath = '/api/parts/shells\\:proxy/calling/openai'

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

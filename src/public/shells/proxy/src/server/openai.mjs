import { loadAIsource } from '../../../../../server/managers/AIsources_manager.mjs'
import { getPartList } from '../../../../../server/managers/index.mjs'
import { v4 as uuidv4 } from 'npm:uuid'
import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

// --- Helper Function for Completions Logic ---
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
		res.setHeader('Cache-Control', 'no-cache')
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
	} else
		// Non-stream response
		res.status(200).json({
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

// --- Helper Function for Chat Completions Logic ---
async function handleChatCompletionsRequest(req, res, username, model) {
	const { messages, max_tokens = 1024, temperature = 0.7, top_p = 1, n = 1, stream = false, stop, presence_penalty = 0, frequency_penalty = 0, logit_bias } = req.body

	if (n > 1)
		return res.status(400).json({ error: { message: 'n > 1 is not supported.', type: 'invalid_request_error', code: 'parameter_not_supported' } })

	if (!messages || !Array.isArray(messages) || messages.length === 0)
		return res.status(400).json({ error: { message: '\'messages\' is required and must be a non-empty array.', type: 'invalid_request_error', code: 'parameter_missing_or_invalid' } })


	const AIsource = await loadAIsource(username, model)
	const fountMessages = messages.map((message) => ({
		role: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'char' : 'system', // Default to system if unknown? Consider erroring.
		content: message.content
	}))

	const result = await AIsource.StructCall({
		chat_log: fountMessages,
		char_prompt: { text: [] },
		user_prompt: { text: [] },
		world_prompt: { text: [] },
		other_chars_prompt: {},
		plugin_prompts: {},
	})

	const text_result = result.content
	const chatId = `chatcmpl-${uuidv4()}`
	const createdTimestamp = Math.floor(Date.now() / 1000)

	if (stream) {
		res.setHeader('Content-Type', 'text/event-stream')
		res.setHeader('Cache-Control', 'no-cache')
		res.setHeader('Connection', 'keep-alive')
		res.flushHeaders() // Ensure headers are sent immediately

		// Send content chunk(s)
		// Basic simulation: send the whole content in one chunk
		const contentChunkData = {
			id: chatId,
			object: 'chat.completion.chunk',
			created: createdTimestamp,
			model,
			choices: [{
				index: 0,
				delta: {
					role: 'assistant',
					content: text_result
				},
				finish_reason: null
			}]
		}
		res.write(`data: ${JSON.stringify(contentChunkData)}\n\n`)

		// Send final chunk with finish reason
		const finalChunkData = {
			id: chatId,
			object: 'chat.completion.chunk',
			created: createdTimestamp, // Can use the same or slightly later timestamp
			model,
			choices: [{
				index: 0,
				delta: {}, // Empty delta in the final chunk
				finish_reason: 'stop' // Indicate completion
			}]
		}
		res.write(`data: ${JSON.stringify(finalChunkData)}\n\n`)

		// Send DONE signal
		res.write('data: [DONE]\n\n')
		res.end()
	} else
		// Non-stream response
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


export function setOpenAIAPIEndpoints(router) {
	const basePath = '/api/shells/proxy/calling/openai'

	// 1. 模型列表 (Models List) - Remains the same
	router.get(basePath + '/v1/models', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			console.log(req.cookies.accessToken, username) // Keep for debugging if needed
			const modelList = await getPartList(username, 'AIsources')
			const formattedModels = {
				object: 'list',
				data: modelList.map(model => ({
					id: model,
					object: 'model',
					created: Math.floor(Date.now() / 1000),
					owned_by: username, // Or a generic owner like "organization-owner" if preferred
				})),
			}
			res.status(200).json(formattedModels)
		} catch (error) {
			console.error('Error fetching models:', error)
			// Differentiate auth errors from other errors if possible based on getUserByReq
			if (error.message === 'Unauthorized' || error.status === 401)
				return res.status(401).json({ error: { message: 'Authentication failed.', type: 'invalid_request_error', code: 'authentication_error' } })

			res.status(500).json({ error: { message: 'Failed to retrieve model list.', type: 'api_error', code: 'internal_server_error' } })
		}
	})

	// --- Wrapper Route Handler for Completions ---
	const processCompletions = async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			// Determine model: check path param first, then body
			const model = req.params.modelname || req.body.model

			if (!model)
				return res.status(400).json({ error: { message: 'Model name not specified in path or request body.', type: 'invalid_request_error', code: 'parameter_missing' } })


			// Call the core logic function
			await handleCompletionsRequest(req, res, username, model)
		} catch (error) {
			console.error('Error processing completions request:', error)
			// Differentiate auth errors from other errors if possible
			if (error.message === 'Unauthorized' || error.status === 401)
				return res.status(401).json({ error: { message: 'Authentication failed.', type: 'invalid_request_error', code: 'authentication_error' } })

			res.status(500).json({ error: { message: 'An internal server error occurred.', type: 'api_error', code: 'internal_server_error' } })
		}
	}

	// --- Wrapper Route Handler for Chat Completions ---
	const processChatCompletions = async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			// Determine model: check path param first, then body
			const model = req.params.modelname || req.body.model

			if (!model)
				return res.status(400).json({ error: { message: 'Model name not specified in path or request body.', type: 'invalid_request_error', code: 'parameter_missing' } })


			// Call the core logic function
			await handleChatCompletionsRequest(req, res, username, model)
		} catch (error) {
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

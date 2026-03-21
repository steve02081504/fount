import fs from 'node:fs'
import path from 'node:path'

import { GeneralChatWrapper, getLlama, LlamaChatSession } from 'npm:node-llama-cpp@3.18.1'

import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../shells/chat/src/prompt_struct.mjs'

import { splitLastUserPrompt } from './src/chatHistory.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此 AI 源的配置模板。
			 * @returns {Promise<object>} 配置模板。
			 */
			GetConfigTemplate: async () => configTemplate,
			GetSource,
		}
	}
}

const configTemplate = {
	name: 'local',
	model_path: '',
	llama_options: {},
	load_model_options: {},
	context_options: {},
	session_options: {
		chatWrapper: 'auto',
		systemPrompt: '',
		forceAddSystemPrompt: false,
	},
	prompt_options: {
		temperature: 0.8,
		topK: 40,
		topP: 0.9,
		maxTokens: 2048,
	},
	system_prompt_at_depth: 10,
	convert_config: {
		roleReminding: true
	},
	use_stream: true,
}

/**
 * @param {object} config - 配置。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Array<{role: string, content: string}>}
 */
function buildChatMessages(prompt_struct, config) {
	let messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
		const images = (chatLogEntry.files || [])
			.filter(file => file.mime_type && file.mime_type.startsWith('image/'))
		let content = chatLogEntry.content
		if (images.length)
			content += '\n' + images.map(() => '[local GGUF: image input omitted]').join('\n')
		return {
			role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
			content,
		}
	})

	const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
	if (system_prompt) {
		const systemMessage = { role: 'system', content: system_prompt }
		if (config.system_prompt_at_depth && config.system_prompt_at_depth < messages.length)
			messages.splice(Math.max(messages.length - config.system_prompt_at_depth, 0), 0, systemMessage)
		else
			messages.unshift(systemMessage)
	}

	if (config.convert_config?.roleReminding ?? true) {
		const isMultiChar = new Set(prompt_struct.chat_log.map(e => e.name).filter(Boolean)).size > 2
		if (isMultiChar)
			messages.push({
				role: 'system',
				content: `Now, please continue the conversation as ${prompt_struct.Charname}.`
			})
	}

	return messages
}

/**
 * @param {Array<{role: string, content: string}>} messages - 含 system 的完整消息。
 * @param {object} config - 配置。
 * @returns {{ dialogMessages: Array<{role: string, content: string}>, mergedSystemPrompt: string|undefined }}
 */
function extractSystemAndDialog(messages, config) {
	const systemParts = []
	const dialog = []
	for (const m of messages) {
		if (m.role === 'system') systemParts.push(String(m.content))
		else dialog.push(m)
	}
	const extra = config.session_options?.systemPrompt
	const merged = [extra, ...systemParts].filter(Boolean).join('\n\n').trim()
	return {
		dialogMessages: dialog,
		mergedSystemPrompt: merged || undefined,
	}
}

/**
 * @param {object} sessionBase - 来自 config.session_options 的副本。
 * @param {object} contextSequence - 上下文序列。
 * @returns {object}
 */
function buildLlamaSessionOptions(sessionBase, contextSequence) {
	const opts = { ...sessionBase, contextSequence }
	if (opts.chatWrapper === 'general')
		opts.chatWrapper = new GeneralChatWrapper()
	else if (!opts.chatWrapper || opts.chatWrapper === 'auto')
		opts.chatWrapper = 'auto'

	if (!opts.systemPrompt?.trim())
		delete opts.systemPrompt

	return opts
}

/**
 * @param {object} config - 配置。
 * @param {object} ctx - 上下文。
 * @param {AbortSignal} [ctx.signal] - 中断信号。
 * @param {(r: {content: string, files: any[]}) => void} [ctx.previewUpdater] - 流式预览。
 * @param {{content: string, files: any[]}} [ctx.result] - 结果累加对象。
 * @param {boolean} [ctx.useStream] - 是否流式。
 * @param {number} [ctx.contextSize] - 上下文 token 上限。
 * @returns {object}
 */
function buildPromptCallOptions(config, ctx) {
	const { signal, previewUpdater, result, useStream, contextSize } = ctx
	const merged = {
		...config.prompt_options,
		signal,
		stopOnAbortSignal: true,
	}
	if (contextSize != null && merged.maxTokens != null)
		merged.maxTokens = Math.min(merged.maxTokens, contextSize)
	else if (contextSize != null && merged.maxTokens == null)
		merged.maxTokens = contextSize
	if (useStream && previewUpdater && result)
		merged.onTextChunk = (chunk) => {
			result.content += chunk
			previewUpdater(result)
		}
	return merged
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const modelPathRaw = config.model_path?.trim()
	if (!modelPathRaw)
		throw new Error('model_path is required (path to a .gguf file)')

	const resolvedPath = path.isAbsolute(modelPathRaw) ? modelPathRaw : path.resolve(modelPathRaw)
	if (!fs.existsSync(resolvedPath))
		throw new Error(`model file not found: ${resolvedPath}`)

	const llama = await getLlama(config.llama_options ?? {})
	const model = await llama.loadModel({
		modelPath: resolvedPath,
		...(config.load_model_options ?? {}),
	})
	const context = await model.createContext(config.context_options ?? {})

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([k, v]) => {
			v.name = config.name || path.basename(resolvedPath)
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		Call: async (prompt) => {
			const sequence = context.getSequence()
			const sessionOpts = buildLlamaSessionOptions({ ...(config.session_options ?? {}) }, sequence)
			const session = new LlamaChatSession(sessionOpts)
			try {
				const text = await session.prompt(prompt, buildPromptCallOptions(config, {
					useStream: false,
					contextSize: context.contextSize,
				}))
				return { content: text }
			}
			finally {
				session.dispose({ disposeSequence: true })
			}
		},

		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options
			const messages = buildChatMessages(prompt_struct, config)
			const { dialogMessages, mergedSystemPrompt } = extractSystemAndDialog(messages, config)
			const { history, lastUser } = splitLastUserPrompt(dialogMessages)
			if (!lastUser)
				throw new Error('no user message to reply to')

			const out = {
				content: '',
				files: [...base_result?.files || []],
			}

			const useStream = (config.use_stream ?? true) && !!replyPreviewUpdater
			const sequence = context.getSequence()
			const sessionOpts = buildLlamaSessionOptions({
				...(config.session_options ?? {}),
				...(mergedSystemPrompt ? { systemPrompt: mergedSystemPrompt } : {}),
			}, sequence)
			const session = new LlamaChatSession(sessionOpts)
			try {
				session.setChatHistory(history)
				const reply = await session.prompt(lastUser, buildPromptCallOptions(config, {
					signal,
					previewUpdater: replyPreviewUpdater,
					result: out,
					useStream,
					contextSize: context.contextSize,
				}))
				if (!useStream)
					out.content = reply
				else if (!out.content && reply)
					out.content = reply
				if (!useStream && replyPreviewUpdater)
					replyPreviewUpdater(out)
			}
			finally {
				session.dispose({ disposeSequence: true })
			}

			return Object.assign(base_result, out)
		},

		tokenizer: {
			free: () => 0,
			encode: prompt => prompt,
			decode: tokens => tokens,
			decode_single: token => token,
			get_token_count: (prompt) => {
				if (!prompt) return 0
				try {
					return model.tokenize(String(prompt)).length
				}
				catch {
					return Math.ceil(String(prompt).length / 4)
				}
			}
		},

		Unload: async () => {
			try {
				await context.dispose?.()
			}
			catch { /* empty */ }
			try {
				await model.dispose?.()
			}
			catch { /* empty */ }
		},
	}
	return result
}

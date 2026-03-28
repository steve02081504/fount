import path from 'node:path'
import fs from 'node:fs'

import { GeneralChatWrapper, getLlama, LlamaChatSession } from 'npm:node-llama-cpp'

import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../../../shells/chat/src/prompt_struct.mjs'
import { buildContentForShowFromLogprobs } from '../../proxy/src/logprobsRenderer.mjs'
import { clearFormat } from '../../proxy/src/responseFormat.mjs'

import { splitLastUserPrompt } from './chatHistory.mjs'
import { buildSamplingReplayOptions, collectLocalLogprobs, createStreamingLogprobsCollector } from './localLogprobs.mjs'

/** @typedef {import('../../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * 构建聊天消息
 * @param {prompt_struct_t} prompt_struct - 结构化提示。
 * @param {object} config - 配置。
 * @returns {Array<{role: string, content: string}>} 供 Llama 会话使用的 role/content 消息数组。
 */
function buildChatMessages(prompt_struct, config) {
	const messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
		const images = (chatLogEntry.files || [])
			.filter(file => file.mime_type && file.mime_type.startsWith('image/'))
		let { content } = chatLogEntry
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
 * 提取系统提示和对话消息
 * @param {Array<{role: string, content: string}>} messages - 含 system 的完整消息。
 * @param {object} config - 配置。
 * @returns {{ dialogMessages: Array<{role: string, content: string}>, mergedSystemPrompt: string|undefined }} 对话消息与合并后的 system 提示。
 */
function extractSystemAndDialog(messages, config) {
	const systemParts = []
	const dialog = []
	for (const m of messages)
		if (m.role === 'system') systemParts.push(String(m.content))
		else dialog.push(m)

	const extra = config.session_options?.systemPrompt
	const merged = [extra, ...systemParts].filter(Boolean).join('\n\n').trim()
	return {
		dialogMessages: dialog,
		mergedSystemPrompt: merged || undefined,
	}
}

/**
 * 构建 Llama 会话选项
 * @param {object} sessionBase - 来自 config.session_options 的副本。
 * @param {object} contextSequence - 上下文序列。
 * @returns {object} 传入 `LlamaChatSession` 的选项对象。
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
 * 构建 prompt 调用选项
 * @param {object} config - 配置。
 * @param {object} ctx - 上下文。
 * @param {AbortSignal} [ctx.signal] - 中断信号。
 * @param {(r: {content: string, files: any[]}) => void} [ctx.previewUpdater] - 流式预览。
 * @param {{content: string, files: any[]}} [ctx.result] - 结果累加对象。
 * @param {boolean} [ctx.useStream] - 是否流式。
 * @param {number} [ctx.contextSize] - 上下文 token 上限。
 * @param {(chunk: object) => void} [ctx.onResponseChunk] - 响应分块（用于 logprobs 等）。
 * @returns {object} 传给 `session.prompt` 的选项（含流式回调等）。
 */
function buildPromptCallOptions(config, ctx) {
	const { signal, previewUpdater, result, useStream, contextSize, onResponseChunk } = ctx
	const merged = {
		...config.prompt_options,
		signal,
		stopOnAbortSignal: true,
	}
	delete merged.logprobs
	delete merged.top_logprobs
	if (contextSize != null && merged.maxTokens != null)
		merged.maxTokens = Math.min(merged.maxTokens, contextSize)
	else if (contextSize != null && merged.maxTokens == null)
		merged.maxTokens = contextSize
	if (useStream && previewUpdater && result)
		merged.onTextChunk = (chunk) => {
			result.content += chunk
			previewUpdater(result)
		}
	if (onResponseChunk)
		merged.onResponseChunk = onResponseChunk
	return merged
}

/**
 * 获取 Local AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
export async function GetSource(config) {
	const modelPathRaw = config.model_path?.trim()
	if (!modelPathRaw)
		throw new Error('model_path is required (path to a .gguf file)')

	const resolvedPath = path.isAbsolute(modelPathRaw) ? modelPathRaw : path.resolve(modelPathRaw)
	if (!fs.existsSync(resolvedPath))
		throw new Error(`model file not found: ${resolvedPath}`)

	const { product_info } = (await import('../locales.json', { with: { type: 'json' } })).default

	const llama = await getLlama(config.llama_options ?? {})
	const model = await llama.loadModel({
		modelPath: resolvedPath,
		...config.load_model_options ?? {},
	})
	const contextOptions = { ...config.context_options ?? {} }
	if (config.prompt_options?.logprobs && (contextOptions.sequences ?? 1) < 2)
		contextOptions.sequences = 2
	const context = await model.createContext(contextOptions)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([k, v]) => {
			v.name = config.name || path.basename(resolvedPath)
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 提示。
		 * @returns {Promise<{content: string}>} 结果。
		 */
		Call: async (prompt) => {
			const sequence = context.getSequence()
			const sessionOpts = buildLlamaSessionOptions({ ...config.session_options ?? {} }, sequence)
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

		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 结构化提示。
		 * @param {object} options - 选项。
		 * @returns {Promise<{content: string}>} 结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal, supported_functions } = options
			const enableLogprobsShow = config.prompt_options?.logprobs && supported_functions?.html
			const useThemeStyles = supported_functions?.fount_themes ?? false
			const streamStartAt = Date.now()
			let firstChunkAt = null
			/** @type {import('npm:node-llama-cpp').Token[]} */
			const streamTokens = []
			let logprobQueue = Promise.resolve()

			const messages = buildChatMessages(prompt_struct, config)
			const { dialogMessages, mergedSystemPrompt } = extractSystemAndDialog(messages, config)
			const { history, lastUser } = splitLastUserPrompt(dialogMessages)
			if (!lastUser)
				throw new Error('no user message to reply to')

			const out = {
				content: '',
				files: [...base_result?.files || []],
				extension: { ...base_result?.extension },
			}

			const useStream = (config.use_stream ?? true) && !!replyPreviewUpdater
			const sequence = context.getSequence()
			/** @type {import('npm:node-llama-cpp').LlamaContextSequence|null} */
			let replaySequence = null
			if (enableLogprobsShow && useStream)
				try {
					replaySequence = context.getSequence()
				}
				catch {
					replaySequence = null
				}

			const sessionOpts = buildLlamaSessionOptions({
				...config.session_options ?? {},
				...mergedSystemPrompt ? { systemPrompt: mergedSystemPrompt } : {},
			}, sequence)
			const session = new LlamaChatSession(sessionOpts)
			let didApplyLogprobs = false
			const topN = Math.max(0, Math.min(20, config.prompt_options?.top_logprobs ?? 5))
			const samplingOpts = buildSamplingReplayOptions(config)
			try {
				session.setChatHistory(history)

				const logprobCollector = enableLogprobsShow && useStream && replaySequence
					? createStreamingLogprobsCollector(model, replaySequence, topN, samplingOpts)
					: null
				if (logprobCollector)
					out.extension.logprobs = { content: [] }

				/**
				 * 更新流式 logprobs 的 wall-clock 指标。
				 * @param {number|undefined} [ttftFallback] - 无首 token chunk 时用作 TTFT（秒）的回退值。
				 */
				const updateStreamingMetrics = (ttftFallback) => {
					const wall = Math.max(0, (Date.now() - streamStartAt) / 1000)
					const nTok = out.extension.logprobs.content.length
					out.extension.logprobs_metrics = {
						ttftSeconds: firstChunkAt != null ? (firstChunkAt - streamStartAt) / 1000 : ttftFallback ?? 0,
						timeSeconds: wall,
						tokensCount: nTok,
						speed: wall > 0 ? nTok / wall : 0,
					}
				}

				const onResponseChunk = enableLogprobsShow && useStream
				? (chunk) => {
					if (chunk.type !== undefined) return
					const newTokens = chunk.tokens
					if (!newTokens?.length) return
					if (firstChunkAt == null) firstChunkAt = Date.now()
					const prevLen = streamTokens.length
					streamTokens.push(...newTokens)
					if (!logprobCollector) return
					logprobQueue = logprobQueue.then(async () => {
						if (signal?.aborted) return
						if (!logprobCollector.isReady) {
							const seq = session.sequence
							const prefixLen = Math.max(0, seq.contextTokens.length - streamTokens.length)
							await logprobCollector.init([...seq.contextTokens.slice(0, prefixLen)])
						}
						const rows = await logprobCollector.collectBatch(streamTokens.slice(prevLen))
						let anyNew = false
						for (const row of rows) {
							if (!row) continue
							out.extension.logprobs.content.push(row)
							anyNew = true
						}
						if (anyNew && !signal?.aborted) {
							updateStreamingMetrics()
							out.content_for_show = buildContentForShowFromLogprobs(out, { useThemeStyles })
							didApplyLogprobs = true
							replyPreviewUpdater?.(clearFormat({ ...out }, prompt_struct))
						}
					})
				}
				: undefined
				const reply = await session.prompt(lastUser, buildPromptCallOptions(config, {
					signal,
					previewUpdater: replyPreviewUpdater,
					result: out,
					useStream,
					contextSize: context.contextSize,
					onResponseChunk,
				}))
				await logprobQueue
				const promptEndAt = Date.now()
				if (!useStream)
					out.content = reply
				else if (!out.content && reply)
					out.content = reply
				if (!useStream && replyPreviewUpdater)
					replyPreviewUpdater(out)

				const streamedLp = out.extension?.logprobs?.content?.length > 0

				if (enableLogprobsShow && streamedLp) {
					updateStreamingMetrics((promptEndAt - streamStartAt) / 1000)
					out.content_for_show = buildContentForShowFromLogprobs(out, { useThemeStyles })
					didApplyLogprobs = true
					replyPreviewUpdater?.(clearFormat({ ...out }, prompt_struct))
				}
				else if (enableLogprobsShow && !streamedLp) {
					let outTokens = streamTokens
					if (!outTokens.length && out.content)
						try { outTokens = model.tokenize(String(out.content)) }
						catch { outTokens = [] }

					if (outTokens.length) {
						const seq = session.sequence
						const ctxTok = [...seq.contextTokens]
						const prefixLen = Math.max(0, ctxTok.length - outTokens.length)
						const { content: lpContent, metrics } = await collectLocalLogprobs(
							model, replaySequence ?? seq, ctxTok.slice(0, prefixLen), outTokens, topN, samplingOpts
						)
						out.extension ??= {}
						out.extension.logprobs = { content: lpContent }
						out.extension.logprobs_metrics = {
							...metrics,
							ttftSeconds: firstChunkAt != null
								? (firstChunkAt - streamStartAt) / 1000
								: (promptEndAt - streamStartAt) / 1000,
						}
						out.content_for_show = buildContentForShowFromLogprobs(out, { useThemeStyles })
						didApplyLogprobs = true
						replyPreviewUpdater?.(clearFormat({ ...out }, prompt_struct))
					}
				}
			}
			finally {
				if (replaySequence)
					try {
						await replaySequence.dispose()
					}
					catch { /* empty */ }

				session.dispose({ disposeSequence: true })
			}

			return Object.assign(base_result, didApplyLogprobs ? clearFormat(out, prompt_struct) : out)
		},

		tokenizer: {
			free: () => 0,
			encode: prompt => prompt,
			decode: tokens => tokens,
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 提示。
			 * @returns {number} 令牌计数。
			 */
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

		/**
		 * 卸载 AI 源。
		 */
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

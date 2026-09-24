import { cleanupResponseText } from '../proxy/src/responseFormat.mjs'
import { buildSourceInfo } from '../proxy/src/sourceInfo.mjs'

import { ClaudeAPI } from './claude_api.mjs'
import { buildClaudeMessages, buildClaudePrompt } from './promptBuilder.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */
/**
 * 提示词结构类型别名。
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

/**
 * Claude AI 来源生成器模块定义。
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
	name: 'Claude',
	model: 'claude-3-sonnet',
	context_size: 200000,
	timeout: 10000,
	cookie_array: [], // 填入你的 Cookie, 格式: ["sessionKey=sk-ant-sid01-..."]
	cookie_counter: 3,
	proxy_password: '',
	r_proxy: '', // 代理
	renew_always: false,       // 是否总是创建新对话, 默认为 false
	prevent_imperson: true, // 是否阻止角色扮演, 默认为 true
}
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<import('../../../../../decl/AIsource.ts').AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) { // 接收 SaveConfig
	const { countTokens } = await import('npm:@anthropic-ai/tokenizer')
	const claudeAPI = new ClaudeAPI(config, SaveConfig) // 传入 SaveConfig

	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: buildSourceInfo(product_info, config),
		is_paid: false,
		extension: {},
		context_size: config.context_size ?? configTemplate.context_size,

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const messages = [{ role: 'user', content: prompt }]
			const system_prompt = 'You are a helpful assistant.' //Call方法可以加个默认的system
			if (system_prompt)
				messages.unshift({  //系统信息置顶
					role: 'system',
					content: system_prompt
				})
			const result = await claudeAPI.callClaudeAPI(messages, config.model)
			return { content: result }
		},

		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			const messages = buildClaudeMessages(prompt_struct)

			/**
			 * 清理 AI 响应的格式，移除 XML 标签和不完整的标记。
			 * @param {object} res - 原始响应对象。
			 * @param {string} res.content - 响应内容。
			 * @returns {object} - 清理后的响应对象。
			 */
			function clearFormat(res) {
				res.content = cleanupResponseText(res.content, prompt_struct)
				return res
			}

			const result = {
				content: '',
				files: [...base_result?.files || []],
			}

			/**
			 * 预览更新器
			 * @param {{content: string, files: any[]}} r - 结果对象
			 * @returns {void}
			 */
			const previewUpdater = r => replyPreviewUpdater?.(clearFormat({ ...r }))

			// Check for abort before starting
			if (signal?.aborted) {
				const err = new Error('Aborted by user')
				err.name = 'AbortError'
				throw err
			}

			// Handle abort during call
			if (signal)
				signal.addEventListener('abort', () => {
					// The claude call doesn't support abort, but we can at least stop waiting
				})


			result.content = await claudeAPI.callClaudeAPI(messages, config.model)
			previewUpdater(result)

			return Object.assign(base_result, clearFormat(result))
		},

		/**
		 * 按本源配置把 prompt_struct 构建成 Claude 出站结构（prompt 字符串 + 消息数组），供快照与缓存对比。
		 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<{prompt: string, chat_log: Array<{role: string, content: string}>}>} 出站结构。
		 */
		BuildPrompt: async prompt_struct => {
			const chat_log = buildClaudeMessages(prompt_struct)
			return { prompt: buildClaudePrompt(chat_log), chat_log }
		},

		tokenizer: {
			/**
			 * 释放分词器。
			 * @returns {number} 0
			 */
			free: () => 0,
			/**
			 * 编码提示。
			 * @param {string} prompt - 要编码的提示。
			 * @returns {string} 编码后的提示。
			 */
			encode: prompt => prompt, // 实际上不需要
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens, // 实际上不需要
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token, // 实际上不需要
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {number} 令牌数。
			 */
			get_token_count: countTokens,
		}
	}

	return result
}

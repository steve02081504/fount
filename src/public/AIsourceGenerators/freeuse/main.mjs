/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { MarkovGenerator } from './MarkovGenerator.mjs'

const endToken = '<|endofres|>'

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	interfaces: {
		AIsource: {
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
	name: 'freeuse',
	model: 'claude-3-5-sonnet',
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const generator = new MarkovGenerator({
		endToken,
	})
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name || config.model || 'freeuse',
				provider: 'freeuse',
				description: 'freeuse',
				description_markdown: 'freeuse',
				version: '0.0.0',
				author: 'steve02081504',
				home_page: '',
				tags: ['free'],
			}
		},
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			return {
				content: generator.generate({
					prompt,
				}),
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			let prompt = structPromptToSingleNoChatLog(prompt_struct)
			prompt += `\
\n${prompt_struct.chat_log.map(item => `${item.name}: ${item.content}\n${endToken}`).join('\n')}
${prompt_struct.Charname}: `
			return {
				content: generator.generate({
					prompt,
				}),
			}
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
			encode: prompt => prompt,
			/**
			 * 解码令牌。
			 * @param {string} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌。
			 * @param {string} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌的提示。
			 * @returns {number} 令牌数。
			 */
			get_token_count: prompt => prompt.length
		}
	}

	return result
}

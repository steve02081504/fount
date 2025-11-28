import fs from 'node:fs'
import path from 'node:path'

import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		AIsource: {
			/**
			 * 获取此 AI 源的配置显示内容。
			 * @returns {Promise<object>} 配置显示内容。
			 */
			GetConfigDisplayContent: async () => ({
				js: fs.readFileSync(path.join(import.meta.dirname, 'display.mjs'), 'utf-8')
			}),
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
	name: 'openai-proxy',
	url: 'https://api.openai.com/v1/chat/completions',
	model: 'gpt-3.5-turbo',
	apikey: '',
	model_arguments: {
		temperature: 1,
		n: 1
	},
	custom_headers: {},
	convert_config: {
		roleReminding: true
	}
}
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { SaveConfig }) {
	/**
	 * 调用基础模型。
	 * @param {Array<object>} messages - 消息数组。
	 * @param {object} config - 配置对象。
	 * @returns {Promise<{content: string, files: any[]}>} 模型返回的内容。
	 */
	async function callBase(messages, config) {
		let text
		let files = []
		while (!text && !files.length) {
			const result = await fetch(config.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: config.apikey ? 'Bearer ' + config.apikey : undefined,
					'HTTP-Referer': 'https://steve02081504.github.io/fount/',
					'X-Title': 'fount',
					...config?.custom_headers
				},
				body: JSON.stringify({
					model: config.model,
					messages,
					stream: false,
					...config.model_arguments,
				})
			})

			if (!result.ok)
				throw result

			text = await result.text()
			if (text.startsWith('data:'))
				text = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).map(JSON.parse).map(json => json.choices[0].delta?.content || '').join('')
			else {
				let json
				try { json = JSON.parse(text) }
				catch { json = await result.json() }
				text = json.choices[0].message.content
				let imgindex = 0
				files = (await Promise.all(json.choices[0].message?.images?.map?.(async imageurl => ({
					name: `image${imgindex++}.png`,
					buffer: await (await fetch(imageurl)).arrayBuffer(),
					mimetype: 'image/png'
				})) || [])).filter(Boolean)
			}
		}
		return {
			content: text,
			files,
		}
	}
	/**
	 * 调用基础模型（带重试）。
	 * @param {Array<object>} messages - 消息数组。
	 * @returns {Promise<{content: string, files: any[]}>} 模型返回的内容。
	 */
	async function callBaseEx(messages) {
		const errors = []
		let retryConfigs = [
			{}, // 第一次尝试，使用原始配置
			{ urlSuffix: '/v1/chat/completions' },
			{ urlSuffix: '/chat/completions' },
		]
		if (config.url.endsWith('/chat/completions'))
			retryConfigs = retryConfigs.filter(config => !config?.urlSuffix?.endsWith?.('/chat/completions'))

		for (const retryConfig of retryConfigs) {
			const currentConfig = { ...config } // 复制配置，避免修改原始配置
			if (retryConfig.urlSuffix) currentConfig.url += retryConfig.urlSuffix

			try {
				const result = await callBase(messages, currentConfig)

				if (retryConfig.urlSuffix)
					console.warn(`the api url of ${config.model} need to change from ${config.url} to ${currentConfig.url}`)

				if (retryConfig.urlSuffix) {
					Object.assign(config, currentConfig)
					SaveConfig()
				}

				return result
			} catch (error) { errors.push(error) }
		}
		throw errors.length == 1 ? errors[0] : errors
	}
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name || config.model
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			return await callBaseEx([
				{
					role: 'system',
					content: prompt
				}
			])
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
				const uid = Math.random().toString(36).slice(2, 10)
				const textContent = `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`
				/** @type {{role: 'user'|'assistant'|'system', content: string | object[]}} */
				const message = {
					role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
					content: textContent,
				}

				if (chatLogEntry.files?.length) {
					const contentParts = [{ type: 'text', text: textContent }]

					for (const file of chatLogEntry.files)
						if (file.mime_type && file.mime_type.startsWith('image/'))
							contentParts.push({
								type: 'image_url',
								image_url: {
									url: `data:${file.mime_type};base64,${file.buffer.toString('base64')}`,
								},
							})


					if (contentParts.length > 1)
						message.content = contentParts
				}

				return message
			})

			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			if (config.system_prompt_at_depth ?? 10)
				messages.splice(Math.max(messages.length - (config.system_prompt_at_depth ?? 10), 0), 0, {
					role: 'system',
					content: system_prompt
				})
			else
				messages.unshift({
					role: 'system',
					content: system_prompt
				})

			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `现在请以${prompt_struct.Charname}的身份续写对话。`
					})
			}

			const result = await callBaseEx(messages)

			let text = result.content

			if (text.match(/<\/sender>\s*<content>/))
				text = text.match(/<\/sender>\s*<content>([\S\s]*)<\/content>/)[1].split(new RegExp(
					`(${(prompt_struct.alternative_charnames || []).map(Object).map(
						stringOrReg => {
							if (stringOrReg instanceof String) return escapeRegExp(stringOrReg)
							return stringOrReg.source
						}
					).join('|')
					})\\s*<\\/sender>\\s*<content>`
				)).pop().split(/<\/content>\s*<\/message/).shift()
			if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
				text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()

			return {
				...result,
				content: text
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

import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/server/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

export default {
	interfaces: {
		AIsource: {
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
	convert_config: {
		roleReminding: true
	}
}
async function GetSource(config, { SaveConfig }) {
	async function callBase(messages, config) {
		let text
		let files = []
		while (!text && !files.length) {
			const result = await fetch(config.url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': config.apikey ? 'Bearer ' + config.apikey : undefined
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
				text = text.split('\n').filter((line) => line.startsWith('data:')).map(line => line.slice(5).trim()).map(JSON.parse).map((json) => json.choices[0].delta.content).join('')
			else {
				let json
				try { json = JSON.parse(text) }
				catch { json = await result.json() }
				text = json.choices[0].message.content
				let imgindex = 0
				files = (await Promise.all(json.choices[0].message?.images?.map?.(async (imageurl) => ({
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
	async function callBaseEx(messages) {
		const errors = []
		let retryConfigs = [
			{}, // 第一次尝试，使用原始配置
			{ urlSuffix: '/v1/chat/completions' },
			{ urlSuffix: '/chat/completions' },
		]
		if (config.url.endsWith('/chat/completions'))
			retryConfigs = retryConfigs.filter((config) => !config?.urlSuffix?.endsWith?.('/chat/completions'))

		for (const retryConfig of retryConfigs) {
			const currentConfig = { ...config } // 复制配置，避免修改原始配置
			if (retryConfig.urlSuffix)
				currentConfig.url += retryConfig.urlSuffix

			try {
				const result = await callBase(messages, currentConfig)

				if (retryConfig.urlSuffix)
					console.warn(`the api url of ${config.model} need to change from ${config.url} to ${currentConfig.url}`)

				if (retryConfig.urlSuffix) {
					Object.assign(config, currentConfig)
					SaveConfig()
				}

				return result
			} catch (error) {
				errors.push(error)
			}
		}
		throw errors.length == 1 ? errors[0] : errors
	}
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'': {
				avatar: '',
				name: config.name || config.model,
				provider: config.provider || 'unknown',
				description: 'proxy',
				description_markdown: 'proxy',
				version: '0.0.0',
				author: 'steve02081504',
				home_page: '',
				tags: ['proxy'],
			}
		},
		is_paid: false,
		extension: {},

		Unload: () => { },
		Call: async (prompt) => {
			return await callBaseEx([
				{
					role: 'system',
					content: prompt
				}
			])
		},
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			margeStructPromptChatLog(prompt_struct).forEach((chatLogEntry) => {
				const uid = Math.random().toString(36).slice(2, 10)
				messages.push({
					role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
					content: `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`
				})
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
				const isMutiChar = new Set([...prompt_struct.chat_log.map((chatLogEntry) => chatLogEntry.name).filter(Boolean)]).size > 2
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
					`(${
						(prompt_struct.alternative_charnames || []).map(Object).map(
							(stringOrReg) => {
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
			free: () => 0,
			encode: (prompt) => prompt,
			decode: (tokens) => tokens,
			decode_single: (token) => token,
			get_token_count: (prompt) => prompt.length
		}
	}
	return result
}

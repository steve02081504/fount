import fs from 'node:fs'
import path from 'node:path'

import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Access any OpenAI-compatible API endpoint.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'utility'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'zh-CN': {
			name: '代理',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: '代理',
			description_markdown: '访问任何与 OpenAI 兼容的 API 端点。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['代理', 'openai', 'api', '实用工具'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ar-SA': {
			name: 'بروكسي',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'بروكسي',
			description_markdown: 'الوصول إلى أي نقطة نهاية API متوافقة مع OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['بروكسي', 'openai', 'api', 'أداة'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'de-DE': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Greifen Sie auf jeden OpenAI-kompatiblen API-Endpunkt zu.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'dienstprogramm'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		emoji: {
			name: '🔌🌐',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: '🔗🌍🤖',
			description_markdown: '🌍🔌➡️🤖✨',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['🔌', '🌐', '🔗', '🛠️'],
			home_page: 'https://github.com/steve02081504/fount'
		},
		'es-ES': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Acceda a cualquier punto final de API compatible con OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'utilidad'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'fr-FR': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Accédez à n\'importe quel point de terminaison d\'API compatible avec OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'utilitaire'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'hi-IN': {
			name: 'प्रॉक्सी',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'प्रॉक्सी',
			description_markdown: 'किसी भी OpenAI-संगत API समापन बिंदु तक पहुँचें।',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['प्रॉक्सी', 'ओपनएआई', 'एपीआई', 'उपयोगिता'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'is-IS': {
			name: 'Umboð',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Umboð',
			description_markdown: 'Fáðu aðgang að hvaða OpenAI-samhæfðu API endapunkti sem er.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['umboð', 'openai', 'api', 'gagnsemi'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'it-IT': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Accedi a qualsiasi endpoint API compatibile con OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'utilità'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ja-JP': {
			name: 'プロキシ',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'プロキシ',
			description_markdown: 'OpenAI 互換の API エンドポイントにアクセスします。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['プロキシ', 'openai', 'api', 'ユーティリティ'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ko-KR': {
			name: '프록시',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: '프록시',
			description_markdown: 'OpenAI와 호환되는 모든 API 엔드포인트에 액세스합니다.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['프록시', 'openai', 'api', '유틸리티'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		lzh: {
			name: '通靈中介',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: '通靈中介',
			description_markdown: '通 OpenAI 兼容之靈脈，以達彼岸。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['中介', 'openai', '靈脈', '器用'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'nl-NL': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Toegang tot elk OpenAI-compatibel API-eindpunt.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'hulpprogramma'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'pt-PT': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Aceda a qualquer ponto final de API compatível com OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'utilitário'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ru-RU': {
			name: 'Прокси',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Прокси',
			description_markdown: 'Доступ к любой конечной точке API, совместимой с OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['прокси', 'openai', 'api', 'утилита'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'uk-UA': {
			name: 'Проксі',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Проксі',
			description_markdown: 'Доступ до будь-якої кінцевої точки API, сумісної з OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['проксі', 'openai', 'api', 'утиліта'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'vi-VN': {
			name: 'Proxy',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: 'Proxy',
			description_markdown: 'Truy cập bất kỳ điểm cuối API nào tương thích với OpenAI.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['proxy', 'openai', 'api', 'tiện ích'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'zh-TW': {
			name: '代理',
			avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
			description: '代理',
			description_markdown: '存取任何與 OpenAI 相容的 API 端點。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['代理', 'openai', 'api', '實用程式'],
			home_page: 'https://github.com/steve02081504/fount',
		}
	},
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
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Access any OpenAI-compatible API endpoint.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'utility'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: '代理',
				description_markdown: '访问任何与 OpenAI 兼容的 API 端点。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['代理', 'openai', 'api', '实用工具'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'بروكسي',
				description_markdown: 'الوصول إلى أي نقطة نهاية API متوافقة مع OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['بروكسي', 'openai', 'api', 'أداة'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Greifen Sie auf jeden OpenAI-kompatiblen API-Endpunkt zu.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'dienstprogramm'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			emoji: {
				name: '🔌🌐',
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: '🔗🌍🤖',
				description_markdown: '🌍🔌➡️🤖✨',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['🔌', '🌐', '🔗', '🛠️'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Acceda a cualquier punto final de API compatible con OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'utilidad'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Accédez à n\'importe quel point de terminaison d\'API compatible avec OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'utilitaire'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'प्रॉक्सी',
				description_markdown: 'किसी भी OpenAI-संगत API समापन बिंदु तक पहुँचें।',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['प्रॉक्सी', 'ओपनएआई', 'एपीआई', 'उपयोगिता'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Umboð',
				description_markdown: 'Fáðu aðgang að hvaða OpenAI-samhæfðu API endapunkti sem er.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['umboð', 'openai', 'api', 'gagnsemi'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Accedi a qualsiasi endpoint API compatibile con OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'utilità'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'プロキシ',
				description_markdown: 'OpenAI 互換の API エンドポイントにアクセスします。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['プロキシ', 'openai', 'api', 'ユーティリティ'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: '프록시',
				description_markdown: 'OpenAI와 호환되는 모든 API 엔드포인트에 액세스합니다.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['프록시', 'openai', 'api', '유틸리티'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: '通靈中介',
				description_markdown: '通 OpenAI 兼容之靈脈，以達彼岸。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['中介', 'openai', '靈脈', '器用'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Toegang tot elk OpenAI-compatibel API-eindpunt.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'hulpprogramma'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Aceda a qualquer ponto final de API compatível com OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'utilitário'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Прокси',
				description_markdown: 'Доступ к любой конечной точке API, совместимой с OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['прокси', 'openai', 'api', 'утилита'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Проксі',
				description_markdown: 'Доступ до будь-якої кінцевої точки API, сумісної з OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['проксі', 'openai', 'api', 'утиліта'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: 'Proxy',
				description_markdown: 'Truy cập bất kỳ điểm cuối API nào tương thích với OpenAI.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['proxy', 'openai', 'api', 'tiện ích'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/mdi/earth-arrow-right.svg',
				description: '代理',
				description_markdown: '存取任何與 OpenAI 相容的 API 端點。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['代理', 'openai', 'api', '實用程式'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			}
		},
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

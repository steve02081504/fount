import fs from 'node:fs'
import path from 'node:path'

import { Ollama } from 'npm:ollama'

import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Run large language models locally.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'local', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'zh-CN': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: '在本地运行大型语言模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', '本地', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'ar-SA': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'قم بتشغيل نماذج لغوية كبيرة محليًا.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'محلي', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'de-DE': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Führen Sie große Sprachmodelle lokal aus.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'lokal', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		emoji: {
			name: '🦙',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Run large language models locally.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'local', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'es-ES': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Ejecute grandes modelos de lenguaje localmente.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'local', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'fr-FR': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Exécutez de grands modèles de langage localement.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'local', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'hi-IN': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'ओलामा',
			description_markdown: 'बड़े भाषा मॉडल को स्थानीय रूप से चलाएं।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ओलामा', 'स्थानीय', 'एलएलएम'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'is-IS': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Keyra stór tungumálalíkön á staðnum.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'staðbundið', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'it-IT': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Esegui grandi modelli linguistici in locale.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'locale', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'ja-JP': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: '大規模な言語モデルをローカルで実行します。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'ローカル', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'ko-KR': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: '올라마',
			description_markdown: '로컬에서 대규모 언어 모델을 실행합니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['올라마', '로컬', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		lzh: {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: '於本地運行大型語言模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', '本地', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'nl-NL': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Voer grote taalmodellen lokaal uit.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'lokaal', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'pt-PT': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Execute grandes modelos de linguagem localmente.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'local', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'ru-RU': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Запускайте большие языковые модели локально.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'локальный', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'uk-UA': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Запускайте великі мовні моделі локально.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'локальний', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'vi-VN': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: 'Chạy các mô hình ngôn ngữ lớn cục bộ.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', 'cục bộ', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
		},
		'zh-TW': {
			name: 'Ollama',
			avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
			description: 'Ollama',
			description_markdown: '在本地運行大型語言模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['ollama', '本地', 'llm'],
			home_page: 'https://ollama.com/',
			provider: 'Ollama'
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
	name: 'ollama',
	host: 'http://127.0.0.1:11434',
	model: 'llama3',
	model_arguments: {
		temperature: 1,
		num_predict: -1, // -1 for infinite
	},
	system_prompt_at_depth: 10,
	convert_config: {
		roleReminding: true
	}
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const ollama = new Ollama({ host: config.host })

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Run large language models locally.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'local', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: '在本地运行大型语言模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', '本地', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'قم بتشغيل نماذج لغوية كبيرة محليًا.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'محلي', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Führen Sie große Sprachmodelle lokal aus.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'lokal', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			emoji: {
				name: '🦙',
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Run large language models locally.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'local', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Ejecute grandes modelos de lenguaje localmente.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'local', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Exécutez de grands modèles de langage localement.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'local', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'ओलामा',
				description_markdown: 'बड़े भाषा मॉडल को स्थानीय रूप से चलाएं।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ओलामा', 'स्थानीय', 'एलएलएम'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Keyra stór tungumálalíkön á staðnum.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'staðbundið', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Esegui grandi modelli linguistici in locale.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'locale', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: '大規模な言語モデルをローカルで実行します。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'ローカル', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: '올라마',
				description_markdown: '로컬에서 대규모 언어 모델을 실행합니다.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['올라마', '로컬', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: '於本地運行大型語言模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', '本地', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Voer grote taalmodellen lokaal uit.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'lokaal', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Execute grandes modelos de linguagem localmente.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'local', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Запускайте большие языковые модели локально.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'локальный', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Запускайте великі мовні моделі локально.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'локальний', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: 'Chạy các mô hình ngôn ngữ lớn cục bộ.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', 'cục bộ', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/ollama.svg',
				description: 'Ollama',
				description_markdown: '在本地運行大型語言模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['ollama', '本地', 'llm'],
				home_page: 'https://ollama.com/',
				provider: 'Ollama'
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
			const response = await ollama.generate({
				model: config.model,
				prompt,
				stream: false,
				options: config.model_arguments
			})
			return {
				content: response.response,
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = margeStructPromptChatLog(prompt_struct).map(chatLogEntry => {
				const images = (chatLogEntry.files || [])
					.filter(file => file.mime_type && file.mime_type.startsWith('image/'))
					.map(file => file.buffer.toString('base64'))

				/** @type {{role: 'user'|'assistant'|'system', content: string, images?: string[]}} */
				const message = {
					role: chatLogEntry.role === 'user' ? 'user' : chatLogEntry.role === 'system' ? 'system' : 'assistant',
					content: chatLogEntry.content,
				}
				if (images.length) message.images = images

				return message
			})

			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)
			if (system_prompt) {
				const systemMessage = {
					role: 'system',
					content: system_prompt
				}
				if (config.system_prompt_at_depth && config.system_prompt_at_depth < messages.length)
					messages.splice(Math.max(messages.length - config.system_prompt_at_depth, 0), 0, systemMessage)
				else
					messages.unshift(systemMessage)

			}


			if (config.convert_config?.roleReminding ?? true) {
				const isMutiChar = new Set(prompt_struct.chat_log.map(chatLogEntry => chatLogEntry.name).filter(Boolean)).size > 2
				if (isMutiChar)
					messages.push({
						role: 'system',
						content: `Now, please continue the conversation as ${prompt_struct.Charname}.`
					})
			}

			let response_text = ''
			const response_files = []

			const response = await ollama.chat({
				model: config.model,
				messages,
				stream: false,
				options: config.model_arguments
			})
			response_text = response.message.content

			return {
				content: response_text,
				files: response_files
			}
		},
		tokenizer: {
			/**
			 * 释放分词器。
			 * @param {any} _ - 未使用。
			 * @returns {number} 0
			 */
			free: _ => 0,
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
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: async prompt => {
				if (!prompt) return 0
				try {
					const response = await ollama.encode({ model: config.model, prompt })
					return response.tokens.length
				}
				catch (error) {
					console.warn('Failed to get token count from Ollama API, falling back to character count.', error)
					return (prompt?.length ?? 0) / 4
				}
			}
		}
	}
	return result
}

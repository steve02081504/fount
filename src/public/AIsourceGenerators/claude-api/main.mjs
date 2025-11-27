// 导入 Anthropic SDK 和 fount 需要的工具函数
import * as mime from 'npm:mime-types'

import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

// Claude 支持的图片 MIME 类型
const supportedImageTypes = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
]

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Claude API by Anthropic',
			description_markdown: 'Direct access to Anthropic\'s powerful Claude models via their official API.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'zh-CN': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Anthropic 的 Claude API',
			description_markdown: '通过官方 API 直接访问 Anthropic 强大的 Claude 模型。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'ar-SA': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'واجهة برمجة تطبيقات كلود بواسطة الأنثروبيك',
			description_markdown: 'الوصول المباشر إلى نماذج كلود القوية من Anthropic عبر واجهة برمجة التطبيقات الرسمية الخاصة بهم.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['كلود', 'أنثروبيك', 'ذكاء اصطناعي', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'de-DE': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Claude-API von Anthropic',
			description_markdown: 'Direkter Zugriff auf die leistungsstarken Claude-Modelle von Anthropic über deren offizielle API.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ki', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		emoji: {
			name: '🤖🔌',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Claude API by Anthropic',
			description_markdown: 'Direct access to Anthropic\'s powerful Claude models via their official API.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'es-ES': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API de Claude de Anthropic',
			description_markdown: 'Acceso directo a los potentes modelos Claude de Anthropic a través de su API oficial.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ia', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'fr-FR': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API Claude d\'Anthropic',
			description_markdown: 'Accès direct aux puissants modèles Claude d\'Anthropic via leur API officielle.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ia', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'hi-IN': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'एंथ्रोपिक द्वारा क्लाउड एपीआई',
			description_markdown: 'एंथ्रोपिक के शक्तिशाली क्लाउड मॉडल तक उनकी आधिकारिक एपीआई के माध्यम से सीधी पहुंच।',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['क्लाउड', 'एंथ्रोपिक', 'एआई', 'एपीआई'],
			home_page: 'https://www.anthropic.com/api'
		},
		'is-IS': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Claude API frá Anthropic',
			description_markdown: 'Beinn aðgangur að öflugum Claude-líkönum Anthropic í gegnum opinbert API þeirra.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'gervigreind', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'it-IT': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API Claude di Anthropic',
			description_markdown: 'Accesso diretto ai potenti modelli Claude di Anthropic tramite la loro API ufficiale.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ia', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'ja-JP': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'アンソロピックの Claude API',
			description_markdown: '公式 API を介したアンソロピックの強力な Claude モデルへの直接アクセス。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['クロード', 'アンソロピック', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'ko-KR': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: '앤트로픽의 클로드 API',
			description_markdown: '공식 API를 통해 앤트로픽의 강력한 클로드 모델에 직접 액세스할 수 있습니다.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['클로드', '앤트로픽', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		lzh: {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: '人擇之克勞德接口',
			description_markdown: '由官接口直取人擇之強克勞德模。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['克勞德', '人擇', '智械', '接口'],
			home_page: 'https://www.anthropic.com/api'
		},
		'nl-NL': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Claude API van Anthropic',
			description_markdown: 'Directe toegang tot de krachtige Claude-modellen van Anthropic via hun officiële API.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'pt-PT': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API Claude da Anthropic',
			description_markdown: 'Acesso direto aos poderosos modelos Claude da Anthropic através de sua API oficial.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ia', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'ru-RU': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API Клода от Anthropic',
			description_markdown: 'Прямой доступ к мощным моделям Клода от Anthropic через их официальный API.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['клод', 'anthropic', 'ии', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'uk-UA': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API Клода від Anthropic',
			description_markdown: 'Прямий доступ до потужних моделей Клода від Anthropic через їхній офіційний API.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['клод', 'anthropic', 'ші', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'vi-VN': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'API Claude của Anthropic',
			description_markdown: 'Truy cập trực tiếp vào các mô hình Claude mạnh mẽ của Anthropic thông qua API chính thức của họ.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		},
		'zh-TW': {
			name: 'Claude API',
			avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
			description: 'Anthropic 的 Claude API',
			description_markdown: '透過官方 API 直接存取 Anthropic 強大的 Claude 模型。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['claude', 'anthropic', 'ai', 'api'],
			home_page: 'https://www.anthropic.com/api'
		}
	},
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

// Claude 模块的默认配置模板
const configTemplate = {
	name: 'claude-3.5-sonnet',
	apikey: '',
	model: 'claude-3-5-sonnet-20240620',
	model_arguments: {
	},
	proxy_url: '', // 例如 'http://127.0.0.1:7890'
	use_stream: true,
}

/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config) {
	const Anthropic = await import('npm:@anthropic-ai/sdk')
	// 初始化 Anthropic 客户端
	const clientOptions = {
		apiKey: config.apikey,
	}

	// 如果配置了代理 URL，则设置代理
	if (config.proxy_url) {
		const undici = await import('npm:undici')
		clientOptions.fetchOptions = {
			dispatcher: new undici.ProxyAgent(config.proxy_url),
		}
	}

	const client = new Anthropic(clientOptions)

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude API by Anthropic',
				description_markdown: 'Direct access to Anthropic\'s powerful Claude models via their official API.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Anthropic 的 Claude API',
				description_markdown: '通过官方 API 直接访问 Anthropic 强大的 Claude 模型。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'واجهة برمجة تطبيقات كلود بواسطة الأنثروبيك',
				description_markdown: 'الوصول المباشر إلى نماذج كلود القوية من Anthropic عبر واجهة برمجة التطبيقات الرسمية الخاصة بهم.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['كلود', 'أنثروبيك', 'ذكاء اصطناعي', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude-API von Anthropic',
				description_markdown: 'Direkter Zugriff auf die leistungsstarken Claude-Modelle von Anthropic über deren offizielle API.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ki', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			emoji: {
				name: '🤖🔌',
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude API by Anthropic',
				description_markdown: 'Direct access to Anthropic\'s powerful Claude models via their official API.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API de Claude de Anthropic',
				description_markdown: 'Acceso directo a los potentes modelos Claude de Anthropic a través de su API oficial.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API Claude d\'Anthropic',
				description_markdown: 'Accès direct aux puissants modèles Claude d\'Anthropic via leur API officielle.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'एंथ्रोपिक द्वारा क्लाउड एपीआई',
				description_markdown: 'एंथ्रोपिक के शक्तिशाली क्लाउड मॉडल तक उनकी आधिकारिक एपीआई के माध्यम से सीधी पहुंच।',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['क्लाउड', 'एंथ्रोपिक', 'एआई', 'एपीआई'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude API frá Anthropic',
				description_markdown: 'Beinn aðgangur að öflugum Claude-líkönum Anthropic í gegnum opinbert API þeirra.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'gervigreind', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API Claude di Anthropic',
				description_markdown: 'Accesso diretto ai potenti modelli Claude di Anthropic tramite la loro API ufficiale.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'アンソロピックの Claude API',
				description_markdown: '公式 API を介したアンソロピックの強力な Claude モデルへの直接アクセス。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['クロード', 'アンソロピック', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: '앤트로픽의 클로드 API',
				description_markdown: '공식 API를 통해 앤트로픽의 강력한 클로드 모델에 직접 액세스할 수 있습니다.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['클로드', '앤트로픽', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: '人擇之克勞德接口',
				description_markdown: '由官接口直取人擇之強克勞德模。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['克勞德', '人擇', '智械', '接口'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Claude API van Anthropic',
				description_markdown: 'Directe toegang tot de krachtige Claude-modellen van Anthropic via hun officiële API.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API Claude da Anthropic',
				description_markdown: 'Acesso direto aos poderosos modelos Claude da Anthropic através de sua API oficial.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ia', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API Клода от Anthropic',
				description_markdown: 'Прямой доступ к мощным моделям Клода от Anthropic через их официальный API.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['клод', 'anthropic', 'ии', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API Клода від Anthropic',
				description_markdown: 'Прямий доступ до потужних моделей Клода від Anthropic через їхній офіційний API.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['клод', 'anthropic', 'ші', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'API Claude của Anthropic',
				description_markdown: 'Truy cập trực tiếp vào các mô hình Claude mạnh mẽ của Anthropic thông qua API chính thức của họ.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://api.iconify.design/simple-icons/anthropic.svg',
				description: 'Anthropic 的 Claude API',
				description_markdown: '透過官方 API 直接存取 Anthropic 強大的 Claude 模型。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['claude', 'anthropic', 'ai', 'api'],
				provider: 'anthropic',
				home_page: 'https://www.anthropic.com/api'
			}
		},
		is_paid: true,
		extension: {},

		// 简单的文本调用
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			const params = {
				model: config.model,
				messages: [{ role: 'user', content: prompt }],
				...config.model_arguments,
			}

			let text = ''

			if (config.use_stream) {
				const stream = await client.messages.create({ ...params, stream: true })
				for await (const event of stream)
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
						text += event.delta.text
			}
			else {
				const message = await client.messages.create(params)
				// Claude 的响应 content 是一个数组，我们只取文本部分
				text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
			}

			return { content: text }
		},

		// 结构化的多模态调用
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项，包含基础结果、进度回调和中断信号。
		 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			const { base_result, replyPreviewUpdater, signal } = options
			/**
			 * 清理 AI 响应的格式，移除 XML 标签和不完整的标记。
			 * @param {object} res - 原始响应对象。
			 * @param {string} res.content - 响应内容。
			 * @returns {object} - 清理后的响应对象。
			 */
			function clearFormat(res) {
				let text = res.content
				if (text.match(/<\/sender>\s*<content>/))
					text = (text.match(/<\/sender>\s*<content>([\S\s]*)/)?.[1] ?? text).split(new RegExp(
						`(${(prompt_struct.alternative_charnames || []).map(Object).map(
							s => s instanceof String ? escapeRegExp(s) : s.source
						).join('|')})\\s*<\\/sender>\\s*<content>`
					)).pop().split(/<\/content>\s*<\/message/).shift()
				if (text.match(/<\/content>\s*<\/message[^>]*>\s*$/))
					text = text.split(/<\/content>\s*<\/message[^>]*>\s*$/).shift()
				// 清理可能出现的不完整的结束标签
				text = text.replace(/<\/content\s*$/, '').replace(/<\/message\s*$/, '').replace(/<\/\s*$/, '')
				// 清理 declare 标签
				text = text.replace(/<declare>[^]*?<\/declare>\s*$/, '').replace(/<declare>[^]*$/, '')
				res.content = text
				return res
			}
			// 使用 fount 工具函数获取独立的系统提示
			const system_prompt = structPromptToSingleNoChatLog(prompt_struct)

			// 使用 fount 工具函数合并聊天记录，并转换为 Claude 的格式
			const messages = await Promise.all(margeStructPromptChatLog(prompt_struct).map(async chatLogEntry => {
				const role = chatLogEntry.role === 'user' || chatLogEntry.role === 'system' ? 'user' : 'assistant'

				// 内容可以是文本和图片的混合数组
				const content = []

				const uid = Math.random().toString(36).slice(2, 10)

				// 添加文本内容
				content.push({
					type: 'text',
					text: `\
<message "${uid}">
<sender>${chatLogEntry.name}</sender>
<content>
${chatLogEntry.content}
</content>
</message "${uid}">
`,
				})

				// 处理并添加文件内容（仅限图片）
				if (chatLogEntry.files)
					for (const file of chatLogEntry.files) {
						const mime_type = file.mime_type || mime.lookup(file.name) || 'application/octet-stream'
						if (supportedImageTypes.includes(mime_type))
							try {
								content.push({
									type: 'image',
									source: {
										type: 'base64',
										media_type: mime_type,
										data: file.buffer.toString('base64'),
									}
								})
							}
							catch (error) {
								console.error(`Failed to process image file ${file.name}:`, error)
								// 如果处理失败，可以添加一条错误信息文本
								content.push({
									type: 'text',
									text: `[System Error: Failed to process image file ${file.name}]`,
								})
							}
						else {
							console.warn(`Unsupported file type for Claude: ${mime_type} for file ${file.name}. Skipping.`)
							content.push({
								type: 'text',
								text: `[System Info: File ${file.name} with type ${mime_type} was skipped as it is not a supported image format.]`
							})
						}
					}


				return { role, content }
			}))

			// 构建最终的 API 请求参数
			const params = {
				model: config.model,
				system: system_prompt,
				messages,
				...config.model_arguments,
			}

			const result = {
				content: '',
				files: base_result?.files || [],
			}
			const onProgressHandler = replyPreviewUpdater ? r => replyPreviewUpdater(clearFormat({ ...r })) : undefined

			if (config.use_stream) {
				const stream = await client.messages.create({ ...params, stream: true }, { signal })
				for await (const event of stream)
					if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
						result.content += event.delta.text
						if (onProgressHandler) onProgressHandler(result)
					}

			}
			else {
				if (signal?.aborted) {
					const err = new Error('Aborted by user')
					err.name = 'AbortError'
					throw err
				}
				const message = await client.messages.create(params, { signal })
				result.content = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
			}

			return Object.assign(base_result, clearFormat(result))
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
			get_token_count: prompt => prompt?.length ?? 0,
		}
	}

	return result
}

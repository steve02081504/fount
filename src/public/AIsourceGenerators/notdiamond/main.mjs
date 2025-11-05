import { escapeRegExp } from '../../../scripts/escape.mjs'
import { margeStructPromptChatLog, structPromptToSingleNoChatLog } from '../../shells/chat/src/prompt_struct.mjs'

import { NotDiamond } from './notdiamond.mjs'
/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Access various open-source and proprietary models through the NotDiamond API.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'zh-CN': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: '通过 NotDiamond API 访问各种开源和专有模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', '代理'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'ar-SA': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'الوصول إلى نماذج مفتوحة المصدر ومملوكة مختلفة من خلال واجهة برمجة تطبيقات NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'بروكسي'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'de-DE': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Greifen Sie über die NotDiamond-API auf verschiedene Open-Source- und proprietäre Modelle zu.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		emoji: {
			name: '💎',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Access various open-source and proprietary models through the NotDiamond API.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'es-ES': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Acceda a varios modelos de código abierto y propietarios a través de la API de NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'fr-FR': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Accédez à divers modèles open source et propriétaires via l\'API NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'hi-IN': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'नॉटडायमंड',
			description_markdown: 'नॉटडायमंड एपीआई के माध्यम से विभिन्न ओपन-सोर्स और मालिकाना मॉडल तक पहुंचें।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['नॉटडायमंड', 'एपीआई', 'प्रॉक्सी'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'is-IS': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Fáðu aðgang að ýmsum opnum og séreignarlíkönum í gegnum NotDiamond API.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'it-IT': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Accedi a vari modelli open source e proprietari tramite l\'API NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'ja-JP': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'NotDiamond API を介して、さまざまなオープンソースおよび独自のモデルにアクセスします。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'プロキシ'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'ko-KR': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'NotDiamond API를 통해 다양한 오픈 소스 및 독점 모델에 액세스하세요.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', '프록시'],
			home_page: 'https://discord.gg/w86nertp',
		},
		lzh: {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: '非鑽石',
			description_markdown: '經非鑽石接口，取諸開源、私有模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['非鑽石', '接口', '代理'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'nl-NL': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Krijg toegang tot verschillende open-source en propriëtaire modellen via de NotDiamond API.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'pt-PT': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Aceda a vários modelos de código aberto e proprietários através da API NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'ru-RU': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Доступ к различным моделям с открытым исходным кодом и проприетарным моделям через API NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'прокси'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'uk-UA': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Доступ до різних моделей з відкритим вихідним кодом та пропрієтарних моделей через API NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'проксі'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'vi-VN': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: 'Truy cập các mô hình nguồn mở và độc quyền khác nhau thông qua API NotDiamond.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', 'proxy'],
			home_page: 'https://discord.gg/w86nertp',
		},
		'zh-TW': {
			name: 'NotDiamond',
			avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
			description: 'NotDiamond',
			description_markdown: '透過 NotDiamond API 存取各種開源和專有模型。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['notdiamond', 'api', '代理'],
			home_page: 'https://discord.gg/w86nertp',
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

const configTemplate = {
	name: 'notdiamond-gpt',
	email: '',
	password: '',
	model: 'gpt-3.5-turbo',
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
	const notDiamond = new NotDiamond({
		email: config.email,
		password: config.password,
	})
	/**
	 * 调用基础模型。
	 * @param {Array<object>} messages - 消息数组。
	 * @returns {Promise<string>} 模型返回的内容。
	 */
	async function callBase(messages) {
		const result = await notDiamond.create({
			messages,
			model: config.model
		})
		if ('detail' in result) throw result.detail
		return result.content
	}
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Access various open-source and proprietary models through the NotDiamond API.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'zh-CN': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: '通过 NotDiamond API 访问各种开源和专有模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', '代理'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'ar-SA': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'الوصول إلى نماذج مفتوحة المصدر ومملوكة مختلفة من خلال واجهة برمجة تطبيقات NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'بروكسي'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'de-DE': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Greifen Sie über die NotDiamond-API auf verschiedene Open-Source- und proprietäre Modelle zu.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			emoji: {
				name: '💎',
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Access various open-source and proprietary models through the NotDiamond API.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'es-ES': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Acceda a varios modelos de código abierto y propietarios a través de la API de NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'fr-FR': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Accédez à divers modèles open source et propriétaires via l\'API NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'hi-IN': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'नॉटडायमंड',
				description_markdown: 'नॉटडायमंड एपीआई के माध्यम से विभिन्न ओपन-सोर्स और मालिकाना मॉडल तक पहुंचें।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['नॉटडायमंड', 'एपीआई', 'प्रॉक्सी'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'is-IS': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Fáðu aðgang að ýmsum opnum og séreignarlíkönum í gegnum NotDiamond API.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'it-IT': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Accedi a vari modelli open source e proprietari tramite l\'API NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'ja-JP': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'NotDiamond API を介して、さまざまなオープンソースおよび独自のモデルにアクセスします。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'プロキシ'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'ko-KR': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'NotDiamond API를 통해 다양한 오픈 소스 및 독점 모델에 액세스하세요.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', '프록시'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			lzh: {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: '非鑽石',
				description_markdown: '經非鑽石接口，取諸開源、私有模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['非鑽石', '接口', '代理'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'nl-NL': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Krijg toegang tot verschillende open-source en propriëtaire modellen via de NotDiamond API.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'pt-PT': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Aceda a vários modelos de código aberto e proprietários através da API NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'ru-RU': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Доступ к различным моделям с открытым исходным кодом и проприетарным моделям через API NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'прокси'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'uk-UA': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Доступ до різних моделей з відкритим вихідним кодом та пропрієтарних моделей через API NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'проксі'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'vi-VN': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: 'Truy cập các mô hình nguồn mở và độc quyền khác nhau thông qua API NotDiamond.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', 'proxy'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
			},
			'zh-TW': {
				name: config.name || config.model,
				avatar: 'https://cdn.prod.website-files.com/64b9c0f00a5b6bdf6393396c/6823997d4ea476ed4b47cab8_ND%20logo.svg',
				description: 'NotDiamond',
				description_markdown: '透過 NotDiamond API 存取各種開源和專有模型。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['notdiamond', 'api', '代理'],
				home_page: 'https://discord.gg/w86nertp',
				provider: 'NotDiamond'
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
			const result = await callBase([
				{
					role: 'system',
					content: prompt
				}
			])
			return {
				content: result,
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<{content: string}>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			const messages = []
			margeStructPromptChatLog(prompt_struct).forEach(chatLogEntry => {
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
			messages.splice(Math.max(messages.length - 10, 0), 0, {
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

			let text = await callBase(messages)

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
				content: text,
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
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => notDiamond.countTokens(prompt)
		}
	}

	return result
}

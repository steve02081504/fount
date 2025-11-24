/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'


/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Polling',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Polling',
			description_markdown: 'A source that cycles through a list of sources, using the next one for each request.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['polling', 'utility', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'zh-CN': {
			name: '轮询',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: '轮询',
			description_markdown: '一个在源列表中循环的源，每个请求使用下一个源。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['轮询', '实用工具', '元'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ar-SA': {
			name: 'الاقتراع',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'الاقتراع',
			description_markdown: 'مصدر يدور عبر قائمة من المصادر، باستخدام المصدر التالي لكل طلب.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['الاقتراع', 'أداة', 'ميتا'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'de-DE': {
			name: 'Polling',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Polling',
			description_markdown: 'Eine Quelle, die eine Liste von Quellen durchläuft und für jede Anfrage die nächste verwendet.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['Polling', 'Dienstprogramm', 'Meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		emoji: {
			name: '🎡🔄',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: '🔢🔄',
			description_markdown: '1️⃣➡️2️⃣➡️3️⃣🔄',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['🎡', '🔢', '🔄'],
			home_page: 'https://github.com/steve02081504/fount'
		},
		'es-ES': {
			name: 'Sondeo',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Sondeo',
			description_markdown: 'Una fuente que recorre una lista de fuentes, utilizando la siguiente para cada solicitud.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['sondeo', 'utilidad', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'fr-FR': {
			name: 'Sondage',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Sondage',
			description_markdown: 'Une source qui parcourt une liste de sources, en utilisant la suivante pour chaque demande.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['sondage', 'utilitaire', 'méta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'hi-IN': {
			name: 'पोलिंग',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'पोलिंग',
			description_markdown: 'एक स्रोत जो स्रोतों की एक सूची से गुजरता है, प्रत्येक अनुरोध के लिए अगले का उपयोग करता है।',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['पोलिंग', 'उपयोगिता', 'मेटा'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'is-IS': {
			name: 'Könnun',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Könnun',
			description_markdown: 'Heimild sem fer í hringi í gegnum lista yfir heimildir og notar þá næstu fyrir hverja beiðni.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['könnun', 'gagnsemi', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'it-IT': {
			name: 'Polling',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Polling',
			description_markdown: 'Una fonte che scorre un elenco di fonti, utilizzando quella successiva per ogni richiesta.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['polling', 'utilità', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ja-JP': {
			name: 'ポーリング',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'ポーリング',
			description_markdown: 'ソースのリストを順番に繰り返し、リクエストごとに次のソースを使用するソース。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['ポーリング', 'ユーティリティ', 'メタ'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ko-KR': {
			name: '폴링',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: '폴링',
			description_markdown: '소스 목록을 순환하며 각 요청에 대해 다음 소스를 사용하는 소스입니다.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['폴링', '유틸리티', '메타'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		lzh: {
			name: '輪番',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: '輪番致用',
			description_markdown: '諸源列隊，輪番致用，周而復始。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['輪番', '器用', '元'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'nl-NL': {
			name: 'Polling',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Polling',
			description_markdown: 'Een bron die door een lijst met bronnen fietst en voor elk verzoek de volgende gebruikt.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['polling', 'hulpprogramma', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'pt-PT': {
			name: 'Polling',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Polling',
			description_markdown: 'Uma fonte que percorre uma lista de fontes, usando a próxima para cada solicitação.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['polling', 'utilitário', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'ru-RU': {
			name: 'Опрос',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Опрос',
			description_markdown: 'Источник, который циклически перебирает список источников, используя следующий для каждого запроса.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['опрос', 'утилита', 'мета'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'uk-UA': {
			name: 'Опитування',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Опитування',
			description_markdown: 'Джерело, яке циклічно перебирає список джерел, використовуючи наступне для кожного запиту.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['опитування', 'утиліта', 'мета'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'vi-VN': {
			name: 'Thăm dò ý kiến',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: 'Thăm dò ý kiến',
			description_markdown: 'Một nguồn quay vòng qua danh sách các nguồn, sử dụng nguồn tiếp theo cho mỗi yêu cầu.',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['thăm dò ý kiến', 'tiện ích', 'meta'],
			home_page: 'https://github.com/steve02081504/fount',
		},
		'zh-TW': {
			name: '輪詢',
			avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
			description: '輪詢',
			description_markdown: '一個在來源清單中循環的來源，每個請求使用下一個來源。',
			version: '0.0.0',
			author: 'steve02081504',
			tags: ['輪詢', '實用程式', '元'],
			home_page: 'https://github.com/steve02081504/fount',
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
	name: 'polling array',
	provider: 'unknown',
	sources: [
		'source name1',
		'source name2',
		{
			generator: 'some generator',
			config: {
				model_name: 'lol',
				other_datas: 'lol'
			}
		}
	],
}
/**
 * 获取 AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} 一个 Promise，解析为 AI 源。
 */
async function GetSource(config, { username, SaveConfig }) {
	let index = -1
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadAIsourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: {
			'en-UK': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Polling',
				description_markdown: 'A source that cycles through a list of sources, using the next one for each request.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['polling', 'utility', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'zh-CN': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: '轮询',
				description_markdown: '一个在源列表中循环的源，每个请求使用下一个源。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['轮询', '实用工具', '元'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ar-SA': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'الاقتراع',
				description_markdown: 'مصدر يدور عبر قائمة من المصادر، باستخدام المصدر التالي لكل طلب.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['الاقتراع', 'أداة', 'ميتا'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'de-DE': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Polling',
				description_markdown: 'Eine Quelle, die eine Liste von Quellen durchläuft und für jede Anfrage die nächste verwendet.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['Polling', 'Dienstprogramm', 'Meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			emoji: {
				name: '🎡🔄',
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: '🔢🔄',
				description_markdown: '1️⃣➡️2️⃣➡️3️⃣🔄',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['🎡', '🔢', '🔄'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'es-ES': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Sondeo',
				description_markdown: 'Una fuente que recorre una lista de fuentes, utilizando la siguiente para cada solicitud.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['sondeo', 'utilidad', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'fr-FR': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Sondage',
				description_markdown: 'Une source qui parcourt une liste de sources, en utilisant la suivante pour chaque demande.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['sondage', 'utilitaire', 'méta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'hi-IN': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'पोलिंग',
				description_markdown: 'एक स्रोत जो स्रोतों की एक सूची से गुजरता है, प्रत्येक अनुरोध के लिए अगले का उपयोग करता है।',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['पोलिंग', 'उपयोगिता', 'मेटा'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'is-IS': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Könnun',
				description_markdown: 'Heimild sem fer í hringi í gegnum lista yfir heimildir og notar þá næstu fyrir hverja beiðni.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['könnun', 'gagnsemi', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'it-IT': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Polling',
				description_markdown: 'Una fonte che scorre un elenco di fonti, utilizzando quella successiva per ogni richiesta.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['polling', 'utilità', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ja-JP': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'ポーリング',
				description_markdown: 'ソースのリストを順番に繰り返し、リクエストごとに次のソースを使用するソース。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['ポーリング', 'ユーティリティ', 'メタ'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ko-KR': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: '폴링',
				description_markdown: '소스 목록을 순환하며 각 요청에 대해 다음 소스를 사용하는 소스입니다.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['폴링', '유틸리티', '메타'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			lzh: {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: '輪番致用',
				description_markdown: '諸源列隊，輪番致用，周而復始。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['輪番', '器用', '元'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'nl-NL': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Polling',
				description_markdown: 'Een bron die door een lijst met bronnen fietst en voor elk verzoek de volgende gebruikt.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['polling', 'hulpprogramma', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'pt-PT': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Polling',
				description_markdown: 'Uma fonte que percorre uma lista de fontes, usando a próxima para cada solicitação.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['polling', 'utilitário', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'ru-RU': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Опрос',
				description_markdown: 'Источник, который циклически перебирает список источников, используя следующий для каждого запроса.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['опрос', 'утилита', 'мета'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'uk-UA': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Опитування',
				description_markdown: 'Джерело, яке циклічно перебирає список джерел, використовуючи наступне для кожного запиту.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['опитування', 'утиліта', 'мета'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'vi-VN': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: 'Thăm dò ý kiến',
				description_markdown: 'Một nguồn quay vòng qua danh sách các nguồn, sử dụng nguồn tiếp theo cho mỗi yêu cầu.',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['thăm dò ý kiến', 'tiện ích', 'meta'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			},
			'zh-TW': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/format-list-numbered.svg',
				description: '輪詢',
				description_markdown: '一個在來源清單中循環的來源，每個請求使用下一個來源。',
				version: '0.0.0',
				author: 'steve02081504',
				tags: ['輪詢', '實用程式', '元'],
				home_page: 'https://github.com/steve02081504/fount',
				provider: 'fount'
			}
		},
		is_paid: false,
		extension: {},

		/**
		 * 卸载 AI 源。
		 * @returns {Promise<void[]>} 一个 Promise，在所有未命名源卸载后解析。
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source.Unload())),
		/**
		 * 调用 AI 源。
		 * @param {string} prompt - 要发送给 AI 的提示。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			if (!sources.length) throw new Error('no source selected')
			let error_num = 0
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].Call(prompt)
			} catch (e) {
				console.error(e)
				error_num++
				if (error_num == config.sources.length) throw new Error('all sources failed')
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			if (!sources.length) throw new Error('no source selected')
			let error_num = 0
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].StructCall(prompt_struct)
			} catch (e) {
				console.error(e)
				error_num++
				if (error_num == config.sources.length) throw new Error('all sources failed')
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

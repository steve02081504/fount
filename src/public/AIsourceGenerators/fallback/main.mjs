/** @typedef {import('../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { loadAIsourceFromNameOrConfigData } from '../../../server/managers/AIsource_manager.mjs'

/**
 * @type {import('../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info: {
		'en-UK': {
			name: 'Fallback',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'A source that tries a list of sources in order until one succeeds.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['fallback', 'utility', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'zh-CN': {
			name: '备用',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: '备用',
			description_markdown: '一个按顺序尝试源列表，直到有一个成功为止的源。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['备用', '实用工具', '元'],
			provider: 'unknown',
			home_page: ''
		},
		'ar-SA': {
			name: 'الاحتياطي',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'الاحتياطي',
			description_markdown: 'مصدر يحاول قائمة من المصادر بالترتيب حتى ينجح أحدها.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['احتياطي', 'أداة', 'ميتا'],
			provider: 'unknown',
			home_page: ''
		},
		'de-DE': {
			name: 'Fallback',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'Eine Quelle, die eine Liste von Quellen der Reihe nach ausprobiert, bis eine erfolgreich ist.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['Fallback', 'Dienstprogramm', 'Meta'],
			provider: 'unknown',
			home_page: ''
		},
		emoji: {
			name: '🔄',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'A source that tries a list of sources in order until one succeeds.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['fallback', 'utility', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'es-ES': {
			name: 'Respaldo',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Respaldo',
			description_markdown: 'Una fuente que prueba una lista de fuentes en orden hasta que una tiene éxito.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['respaldo', 'utilidad', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'fr-FR': {
			name: 'Fallback',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'Une source qui essaie une liste de sources dans l\'ordre jusqu\'à ce que l\'une d\'entre elles réussisse.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['fallback', 'utilitaire', 'méta'],
			provider: 'unknown',
			home_page: ''
		},
		'hi-IN': {
			name: 'फ़ॉलबैक',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'फ़ॉलबैक',
			description_markdown: 'एक स्रोत जो स्रोतों की एक सूची को क्रम में तब तक आज़माता है जब तक कि कोई एक सफल न हो जाए।',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['फ़ॉलबैक', 'उपयोगिता', 'मेटा'],
			provider: 'unknown',
			home_page: ''
		},
		'is-IS': {
			name: 'Varaskeifa',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Varaskeifa',
			description_markdown: 'Heimild sem reynir lista yfir heimildir í röð þar til ein tekst.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['varaskeifa', 'gagnsemi', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'it-IT': {
			name: 'Fallback',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'Una fonte che prova un elenco di fonti in ordine finché una non ha successo.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['fallback', 'utilità', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'ja-JP': {
			name: 'フォールバック',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'フォールバック',
			description_markdown: '成功するまでソースのリストを順番に試行するソース。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['フォールバック', 'ユーティリティ', 'メタ'],
			provider: 'unknown',
			home_page: ''
		},
		'ko-KR': {
			name: '폴백',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: '폴백',
			description_markdown: '성공할 때까지 소스 목록을 순서대로 시도하는 소스입니다.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['폴백', '유틸리티', '메타'],
			provider: 'unknown',
			home_page: ''
		},
		lzh: {
			name: '後備',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: '後備',
			description_markdown: '一源，循序試源列，至一得，乃止。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['後備', '用', '元'],
			provider: 'unknown',
			home_page: ''
		},
		'nl-NL': {
			name: 'Fallback',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'Een bron die een lijst met bronnen op volgorde probeert totdat er een slaagt.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['fallback', 'hulpprogramma', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'pt-PT': {
			name: 'Fallback',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Fallback',
			description_markdown: 'Uma fonte que tenta uma lista de fontes em ordem até que uma tenha sucesso.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['fallback', 'utilitário', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'ru-RU': {
			name: 'Резервный',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Резервный',
			description_markdown: 'Источник, который пробует список источников по порядку, пока один из них не сработает.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['резервный', 'утилита', 'мета'],
			provider: 'unknown',
			home_page: ''
		},
		'uk-UA': {
			name: 'Резервний',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Резервний',
			description_markdown: 'Джерело, яке пробує список джерел по порядку, доки одне з них не спрацює.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['резервний', 'утиліта', 'мета'],
			provider: 'unknown',
			home_page: ''
		},
		'vi-VN': {
			name: 'Dự phòng',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: 'Dự phòng',
			description_markdown: 'Một nguồn thử một danh sách các nguồn theo thứ tự cho đến khi một nguồn thành công.',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['dự phòng', 'tiện ích', 'meta'],
			provider: 'unknown',
			home_page: ''
		},
		'zh-TW': {
			name: '備用',
			avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
			description: '備用',
			description_markdown: '一個按順序嘗試來源列表，直到有一個成功為止的來源。',
			version: '0.0.1',
			author: 'steve02081504',
			tags: ['備用', '實用程式', '元'],
			provider: 'unknown',
			home_page: ''
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
	name: 'fallback array',
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
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'A source that tries a list of sources in order until one succeeds.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['fallback', 'utility', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'zh-CN': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: '备用',
				description_markdown: '一个按顺序尝试源列表，直到有一个成功为止的源。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['备用', '实用工具', '元'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ar-SA': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'الاحتياطي',
				description_markdown: 'مصدر يحاول قائمة من المصادر بالترتيب حتى ينجح أحدها.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['احتياطي', 'أداة', 'ميتا'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'de-DE': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'Eine Quelle, die eine Liste von Quellen der Reihe nach ausprobiert, bis eine erfolgreich ist.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['Fallback', 'Dienstprogramm', 'Meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			emoji: {
				name: '🔄',
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'A source that tries a list of sources in order until one succeeds.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['fallback', 'utility', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'es-ES': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Respaldo',
				description_markdown: 'Una fuente que prueba una lista de fuentes en orden hasta que una tiene éxito.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['respaldo', 'utilidad', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'fr-FR': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'Une source qui essaie une liste de sources dans l\'ordre jusqu\'à ce que l\'une d\'entre elles réussisse.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['fallback', 'utilitaire', 'méta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'hi-IN': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'फ़ॉलबैक',
				description_markdown: 'एक स्रोत जो स्रोतों की एक सूची को क्रम में तब तक आज़माता है जब तक कि कोई एक सफल न हो जाए।',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['फ़ॉलबैक', 'उपयोगिता', 'मेटा'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'is-IS': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Varaskeifa',
				description_markdown: 'Heimild sem reynir lista yfir heimildir í röð þar til ein tekst.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['varaskeifa', 'gagnsemi', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'it-IT': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'Una fonte che prova un elenco di fonti in ordine finché una non ha successo.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['fallback', 'utilità', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ja-JP': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'フォールバック',
				description_markdown: '成功するまでソースのリストを順番に試行するソース。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['フォールバック', 'ユーティリティ', 'メタ'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ko-KR': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: '폴백',
				description_markdown: '성공할 때까지 소스 목록을 순서대로 시도하는 소스입니다.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['폴백', '유틸리티', '메타'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			lzh: {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: '後備',
				description_markdown: '一源，循序試源列，至一得，乃止。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['後備', '用', '元'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'nl-NL': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'Een bron die een lijst met bronnen op volgorde probeert totdat er een slaagt.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['fallback', 'hulpprogramma', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'pt-PT': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Fallback',
				description_markdown: 'Uma fonte que tenta uma lista de fontes em ordem até que uma tenha sucesso.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['fallback', 'utilitário', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'ru-RU': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Резервный',
				description_markdown: 'Источник, который пробует список источников по порядку, пока один из них не сработает.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['резервный', 'утилита', 'мета'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'uk-UA': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Резервний',
				description_markdown: 'Джерело, яке пробує список джерел по порядку, доки одне з них не спрацює.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['резервний', 'утиліта', 'мета'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'vi-VN': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: 'Dự phòng',
				description_markdown: 'Một nguồn thử một danh sách các nguồn theo thứ tự cho đến khi một nguồn thành công.',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['dự phòng', 'tiện ích', 'meta'],
				provider: config.provider || 'unknown',
				home_page: ''
			},
			'zh-TW': {
				name: config.name,
				avatar: 'https://api.iconify.design/mdi/backup-restore.svg',
				description: '備用',
				description_markdown: '一個按順序嘗試來源列表，直到有一個成功為止的來源。',
				version: '0.0.1',
				author: 'steve02081504',
				tags: ['備用', '實用程式', '元'],
				provider: config.provider || 'unknown',
				home_page: ''
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
			let index = 0
			while (true) try {
				return await sources[index].Call(prompt)
			}
			catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
			}
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct) => {
			if (!sources.length) throw new Error('no source selected')
			let index = 0
			while (true) try {
				return await sources[index].StructCall(prompt_struct)
			}
			catch (e) {
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(e)
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

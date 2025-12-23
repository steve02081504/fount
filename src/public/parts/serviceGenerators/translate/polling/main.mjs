/** @typedef {import('../../../../../decl/TranslateSource.ts').TranslateSource_t} TranslateSource_t */

import { loadTranslateSourceFromNameOrConfigData } from '../../../serviceSources/translate/main.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }

/**
 * @type {import('../../../../../decl/TranslateSourceGenerator.ts').TranslateSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * 获取此翻译源的配置模板。
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
	max_fail_count: 0,
	random_start: true,
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
 * 获取翻译源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<TranslateSource_t>} 一个 Promise，解析为翻译源。
 */
async function GetSource(config, { username, SaveConfig }) {
	let index = config.random_start ?? true ? Math.floor(Math.random() * config.sources.length) : -1
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadTranslateSourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))

	const maxFailCount = Math.min(
		config.sources.length,
		config.max_fail_count || new Set(config.sources.map(source => source.generator)).size == 1 ? 3 : Infinity
	)
	/** @type {TranslateSource_t} */
	const result = {
		type: 'web-translate',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			return [k, v]
		})),
		is_paid: false,
		extension: {},

		/**
		 * 卸载翻译源。
		 * @returns {Promise<void[]>} 一个 Promise，在所有未命名源卸载后解析。
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source?.Unload?.())),
		/**
		 * 执行翻译。
		 * @param {string} text - 要翻译的文本。
		 * @param {object} [options] - 翻译选项。
		 * @returns {Promise<import('../../../../../decl/TranslateSource.ts').TranslateResult_t>} 翻译结果。
		 */
		Translate: async (text, options = {}) => {
			if (!sources.length) throw new Error('no source selected')
			let error_num = 0
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].Translate(text, options)
			} catch (e) {
				console.error(e)
				error_num++
				if (error_num >= maxFailCount) throw new Error(`Too many failures (${error_num}/${maxFailCount}). Last error: ` + (e.message || e))
			}
		},
		interfaces: {}
	}
	return result
}

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
	name: 'weighted random',
	provider: 'unknown',
	sources: [
		{
			weight: 2,
			source: 'source name1',
		},
		{
			weight: 3,
			source: 'source name2',
		},
		{
			weight: 5,
			source: {
				generator: 'some generator',
				config: {
					model_name: 'some_model',
					other_datas: '...'
				}
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
 * @returns {Promise<TranslateSource_t>} 翻译源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const weightedSources = await Promise.all(config.sources.map(async item => {
		if (typeof item.weight !== 'number' || item.weight <= 0)
			throw new Error(`Source item must have a positive numerical 'weight'. Invalid item: ${JSON.stringify(item.source)}`)
		const sourceInstance = await loadTranslateSourceFromNameOrConfigData(username, item.source, unnamedSources, {
			SaveConfig
		})
		return {
			weight: item.weight,
			source: sourceInstance
		}
	}))

	if (!weightedSources.length)
		throw new Error('no source configured')

	/**
	 * 按权重选择源。
	 * @returns {TranslateSource_t} 选择的源。
	 */
	const selectSourceByWeight = () => {
		const totalWeight = weightedSources.reduce((sum, s) => sum + s.weight, 0)
		let randomValue = Math.random() * totalWeight

		for (const weightedSource of weightedSources) {
			randomValue -= weightedSource.weight
			if (randomValue <= 0)
				return weightedSource.source
		}
	}


	/** @type {TranslateSource_t} */
	const result = {
		type: 'web-translate',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			return [k, v]
		})),
		is_paid: weightedSources.some(s => s.source.is_paid),

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
			const selectedSource = selectSourceByWeight()
			return await selectedSource.Translate(text, options)
		},
		interfaces: {}
	}
	return result
}

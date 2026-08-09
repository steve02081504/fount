/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { loadSpeechRecognitionSourceFromNameOrConfigData } from '../../../serviceSources/SpeechRecognition/main.mjs'
import { buildSourceInfo } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 随机语音识别生成器。
 * @type {import('../../../../../decl/SpeechRecognitionSourceGenerator.ts').SpeechRecognitionSourceGenerator_t}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
			/**
			 * @returns {Promise<object>} 模板
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
		{ weight: 2, source: 'source name1' },
		{ weight: 3, source: 'source name2' },
	],
}

/**
 * @param {object} config 配置
 * @param {object} root0 参数
 * @param {string} root0.username 用户名
 * @param {Function} root0.SaveConfig 保存
 * @returns {Promise<SpeechRecognitionSource_t>} 源
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const weightedSources = await Promise.all(config.sources.map(async item => {
		if (typeof item.weight !== 'number' || !(item.weight > 0))
			throw new Error(`Source item must have a positive numerical 'weight'. Invalid item: ${JSON.stringify(item.source)}`)
		const sourceInstance = await loadSpeechRecognitionSourceFromNameOrConfigData(username, item.source, unnamedSources, {
			SaveConfig
		})
		return { weight: item.weight, source: sourceInstance }
	}))
	if (!weightedSources.length) throw new Error('no source configured')

	/**
	 * @returns {SpeechRecognitionSource_t} 选中的源
	 */
	const selectSourceByWeight = () => {
		const totalWeight = weightedSources.reduce((sum, s) => sum + s.weight, 0)
		let randomValue = Math.random() * totalWeight
		for (const weightedSource of weightedSources) {
			randomValue -= weightedSource.weight
			if (randomValue <= 0) return weightedSource.source
		}
		return weightedSources[weightedSources.length - 1].source
	}

	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name, provider: config.provider || configTemplate.provider }),
		is_paid: weightedSources.some(s => s.source.is_paid),
		extension: {},
		/**
		 * @returns {Promise<void[]>} 卸载所有子源
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source?.Unload?.())),
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			if (options.feed)
				throw new Error('random SpeechRecognition does not support live feed; use audio buffer or a single streaming source')
			return await selectSourceByWeight().Recognize(options)
		},
		interfaces: {}
	}
}

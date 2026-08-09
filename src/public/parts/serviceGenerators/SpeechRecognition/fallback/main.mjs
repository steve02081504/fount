/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { loadSpeechRecognitionSourceFromNameOrConfigData } from '../../../serviceSources/SpeechRecognition/main.mjs'
import { buildSourceInfo } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 故障转移语音识别生成器。
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
	name: 'fallback array',
	provider: 'unknown',
	sources: [
		'source name1',
		'source name2',
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
	const settled = await Promise.allSettled(config.sources.map(source => loadSpeechRecognitionSourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
	const failed = settled.find(entry => entry.status === 'rejected')
	if (failed) {
		await Promise.allSettled(unnamedSources.map(source => source?.Unload?.()))
		throw failed.reason
	}
	const sources = settled.map(entry => /** @type {PromiseFulfilledResult<SpeechRecognitionSource_t>} */entry.value)
	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name, provider: config.provider || 'unknown' }),
		is_paid: false,
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
			if (!sources.length) throw new Error('no source selected')
			if (options.feed)
				throw new Error('fallback SpeechRecognition does not support live feed; use audio buffer or a single streaming source')
			let index = 0
			while (true) try {
				return await sources[index].Recognize(options)
			} catch (error) {
				if (options.signal?.aborted || error?.name === 'AbortError') throw error
				index++
				if (index >= config.sources.length) throw new Error('all sources failed')
				console.error(error)
			}
		},
		interfaces: {}
	}
}

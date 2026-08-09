/**
 * @typedef {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionSource_t} SpeechRecognitionSource_t
 */

import { loadSpeechRecognitionSourceFromNameOrConfigData } from '../../../serviceSources/SpeechRecognition/main.mjs'
import { buildSourceInfo } from '../shared/recognizeHelpers.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * 轮询语音识别生成器。
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
	name: 'polling array',
	provider: 'unknown',
	max_fail_count: 0,
	random_start: true,
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
	let index = config.random_start ?? true ? Math.floor(Math.random() * config.sources.length) : -1
	const unnamedSources = []
	const sources = await Promise.all(config.sources.map(source => loadSpeechRecognitionSourceFromNameOrConfigData(username, source, unnamedSources, {
		SaveConfig
	})))
	const maxFailCount = Math.min(
		config.sources.length,
		config.max_fail_count || new Set(config.sources.map(source => source.generator)).size == 1 ? 3 : Infinity
	)
	return {
		type: 'speech-recognition',
		info: buildSourceInfo(product_info, { name: config.name }),
		is_paid: false,
		extension: {},
		/**
		 * @returns {Promise<void[]>}
		 */
		Unload: () => Promise.all(unnamedSources.map(source => source?.Unload?.())),
		/**
		 * @param {import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionOptions_t} options 选项
		 * @returns {Promise<import('../../../../../decl/SpeechRecognitionSource.ts').SpeechRecognitionResult_t>} 结果
		 */
		Recognize: async (options) => {
			if (!sources.length) throw new Error('no source selected')
			if (options.feed)
				throw new Error('polling SpeechRecognition does not support live feed; use audio buffer or a single streaming source')
			let error_num = 0
			while (true) try {
				index++
				index %= config.sources.length
				return await sources[index].Recognize(options)
			} catch (e) {
				console.error(e)
				error_num++
				if (error_num >= maxFailCount) throw new Error(`Too many failures (${error_num}/${maxFailCount}). Last error: ` + (e.message || e))
			}
		},
		interfaces: {}
	}
}

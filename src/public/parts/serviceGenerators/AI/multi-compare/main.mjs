/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { getPartInfo } from '../../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../../server/auth.mjs'
import { loadAIsourceFromNameOrConfigData } from '../../../serviceSources/AI/main.mjs'

import info_dynamic from './info.dynamic.json' with { type: 'json' }
import info from './info.json' with { type: 'json' }

/**
 * @type {import('../../../../../decl/AIsource.ts').AIsource_interfaces_and_AIsource_t_getter}
 */
export default {
	info,
	interfaces: {
		serviceGenerator: {
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
	name: 'compare array',
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
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			v.provider = config.provider || 'unknown'
			return [k, v]
		})),
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
		 * @returns {Promise<string>} 来自 AI 的结果。
		 */
		Call: async prompt => {
			if (!sources.length) throw new Error('no source selected')
			const results = await Promise.all(sources.map(source => {
				const info = getPartInfo(source, getUserByUsername(username).locales)
				return source.Call(prompt).then(
					result => `\
**${info.name} from ${info.provider}:**
${result}
`,
					err => `\
**${info.name} from ${info.provider} error:**
\`\`\`
${err.stack || err}
\`\`\`
`
				)
			}))
			return results.join('\n')
		},
		/**
	 * 使用结构化提示调用 AI 源。
	 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
	 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
	 * @returns {Promise<{content: string, files: any[]}>} 来自 AI 的结果。
	 */
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			const { base_result = {}, replyPreviewUpdater, signal } = options

			if (!sources.length) throw new Error('no source selected')

			const allFiles = [...base_result?.files || []]
			const sourceResults = sources.map(() => ({ content: '', files: [] }))

			// 为每个源创建子 updater
			/**
			 * 为每个源创建子 updater
			 * @param {number} index - 源的索引
			 * @returns {((subResult: {content: string, files: any[]}) => void) | undefined} - 子 updater 函数或 undefined
			 */
			const createSubUpdater = (index) => {
				if (!replyPreviewUpdater) return undefined

				return (subResult) => {
					// 更新这个源的结果
					sourceResults[index] = { ...subResult }

					// 重新构建完整的比较字符串
					const comparisonParts = sourceResults.map((result, i) => {
						const info = getPartInfo(sources[i], getUserByUsername(username).locales)
						if (!result.content) return ''

						let part = `**${info.name} from ${info.provider}:**\n${result.content}\n`
						if (result.files?.length) {
							const fileStart = allFiles.length + sourceResults.slice(0, i).reduce((sum, r) => sum + (r.files?.length || 0), 0)
							const fileEnd = fileStart + result.files.length
							part += `\nfiles ${fileStart} - ${fileEnd}\n`
						}
						return part
					}).filter(Boolean)

					// 调用真正的 updater
					replyPreviewUpdater({
						content: comparisonParts.join('\n'),
						files: [...allFiles, ...sourceResults.flatMap(r => r.files || [])]
					})
				}
			}

			// 并行调用所有源
			const results = await Promise.all(sources.map((source, index) => {
				const info = getPartInfo(source, getUserByUsername(username).locales)
				const subBaseResult = { files: [] }
				const subUpdater = createSubUpdater(index)

				return source.StructCall(prompt_struct, {
					base_result: subBaseResult,
					replyPreviewUpdater: subUpdater,
					signal
				}).then(
					result => {
						allFiles.push(...result.files || [])
						let res = `**${info.name} from ${info.provider}:**\n${result.content}\n`
						if (result.files?.length) {
							const fileStart = allFiles.length - result.files.length
							const fileEnd = allFiles.length
							res += `\nfiles ${fileStart} - ${fileEnd}\n`
						}
						return res
					},
					err => `**${info.name} from ${info.provider} error:**\n\`\`\`\n${err.stack || err}\n\`\`\`\n`
				)
			}))

			return Object.assign(base_result, {
				content: results.join('\n'),
				files: allFiles
			})
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

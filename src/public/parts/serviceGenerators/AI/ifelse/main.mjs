/**
 * AI 源类型别名。
 * @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t
 */
/**
 * 提示词结构类型别名。
 * @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t
 */

import { async_eval } from 'npm:@steve02081504/async-eval'

import { loadAIsourceFromNameOrConfigData } from '../../../serviceSources/AI/main.mjs'
import { identityTokenizer, minKnownContextSize } from '../proxy/src/identityTokenizer.mjs'

import { buildPromptByCondition, createConditionSelector, promptStructContent } from './prompt.mjs'

const { info, product_info } = (await import('./locales.json', { with: { type: 'json' } })).default

/**
 * IfElse AI 来源生成器模块定义。
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
	name: 'if-else',
	provider: 'unknown',
	rules: [
		{
			type: 'if',
			condition: 'chat_log.some(entry => entry.files?.length)',
			target: 'source name A'
		},
		{
			type: 'if',
			condition: 'true',
			target: 'source name B'
		},
		{
			type: 'if_result',
			condition: 'result.content === "abc"',
			execute: 'throw new Error("结果内容不能是 abc")'
		}
	],
}

/**
 * 获取 IfElse AI 源。
 * @param {object} config - 配置对象。
 * @param {object} root0 - 根对象。
 * @param {string} root0.username - 用户名。
 * @param {Function} root0.SaveConfig - 保存配置的函数。
 * @returns {Promise<AIsource_t>} AI 源。
 */
async function GetSource(config, { username, SaveConfig }) {
	const unnamedSources = []
	const ifRules = config.rules.filter(rule => rule.type === 'if')
	const ifResultRules = config.rules.filter(rule => rule.type === 'if_result')

	// 预加载所有可能用到的源
	const sourceMap = new Map()
	for (const rule of ifRules) {
		if (!rule.target) continue
		const key = JSON.stringify(rule.target)
		if (!sourceMap.has(key)) {
			const sourceInstance = await loadAIsourceFromNameOrConfigData(username, rule.target, unnamedSources, {
				SaveConfig
			})
			sourceMap.set(key, sourceInstance)
		}
	}

	if (!ifRules.length) throw new Error('no if rules configured')

	/**
	 * 根据条件选择源。
	 * @param {string} content - 请求内容。
	 * @param {prompt_struct_t} [prompt_struct] - 结构化提示（可选）。
	 * @returns {Promise<AIsource_t>} 选择的源。
	 */
	const selectSourceByCondition = createConditionSelector({ ifRules, sourceMap })

	/**
	 * 处理 if_result 规则。
	 * @param {any} result - AI 返回的结果。
	 * @returns {Promise<any>} 处理后的结果。
	 */
	const processIfResultRules = async (result) => {
		let currentResult = result
		for (const rule of ifResultRules) {
			if (!rule.condition || !rule.execute) continue

			const evalResult = await async_eval(rule.condition, { result: currentResult })
			if (evalResult.error) {
				console.error('Error evaluating if_result condition:', evalResult.error)
				continue
			}

			if (evalResult.result) {
				const executeResult = await async_eval(rule.execute, { result: currentResult })
				if (executeResult.error) throw executeResult.error
				currentResult = executeResult.result
			}
		}
		return currentResult
	}

	/**
	 * AI 源实例。
	 * @type {AIsource_t}
	 */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(product_info)).map(([k, v]) => {
			v.name = config.name
			v.provider = config.provider || 'unknown'
			return [k, v]
		})),
		is_paid: Array.from(sourceMap.values()).some(source => source.is_paid),
		extension: {},
		context_size: minKnownContextSize(sourceMap.values()),

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
			const selectedSource = await selectSourceByCondition(prompt)
			const aiResult = await selectedSource.Call(prompt)
			return await processIfResultRules(aiResult)
		},
		/**
		 * 使用结构化提示调用 AI 源。
		 * @param {prompt_struct_t} prompt_struct - 要发送给 AI 的结构化提示。
		 * @param {import('../../../../../decl/AIsource.ts').GenerationOptions} [options] - 生成选项。
		 * @returns {Promise<any>} 来自 AI 的结果。
		 */
		StructCall: async (prompt_struct, options = {}) => {
			// 从 prompt_struct 中提取内容用于条件判断
			const content = promptStructContent(prompt_struct)

			const selectedSource = await selectSourceByCondition(content, prompt_struct)
			const aiResult = await selectedSource.StructCall(prompt_struct, options)
			return await processIfResultRules(aiResult)
		},
		/**
		 * 委托条件选中的内层源构建 prompt 结构。
		 * @param {prompt_struct_t} prompt_struct - 结构化提示。
		 * @returns {Promise<object|unknown[]>} 构建结果。
		 */
		BuildPrompt: prompt_struct => buildPromptByCondition(promptStructContent(prompt_struct), prompt_struct, selectSourceByCondition),
		tokenizer: identityTokenizer,
	}
	return result
}

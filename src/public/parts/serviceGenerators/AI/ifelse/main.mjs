/** @typedef {import('../../../../../decl/AIsource.ts').AIsource_t} AIsource_t */
/** @typedef {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct_t */

import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs'

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
 * 获取 AI 源。
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
	const selectSourceByCondition = async (content, prompt_struct = null) => {
		for (const rule of ifRules) {
			if (!rule.condition || !rule.target) continue

			const evalContext = { content }
			if (prompt_struct) {
				evalContext.prompt_struct = prompt_struct
				evalContext.chat_log = prompt_struct.chat_log
			}

			const evalResult = await async_eval(rule.condition, evalContext)
			if (evalResult.error) {
				console.error('Error evaluating condition:', evalResult.error)
				continue
			}

			if (evalResult.result) {
				const key = JSON.stringify(rule.target)
				const source = sourceMap.get(key)
				if (source) return source
			}
		}
		throw new Error('no matching condition found')
	}

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

	/** @type {AIsource_t} */
	const result = {
		type: 'text-chat',
		info: Object.fromEntries(Object.entries(structuredClone(info_dynamic)).map(([k, v]) => {
			v.name = config.name
			v.provider = config.provider || 'unknown'
			return [k, v]
		})),
		is_paid: Array.from(sourceMap.values()).some(source => source.is_paid),
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
		StructCall: async (/** @type {prompt_struct_t} */ prompt_struct, options = {}) => {
			// 从 prompt_struct 中提取内容用于条件判断
			const content = prompt_struct.chat_log
				.map(entry => entry.content)
				.filter(Boolean)
				.join('\n')

			const selectedSource = await selectSourceByCondition(content, prompt_struct)
			const aiResult = await selectedSource.StructCall(prompt_struct, options)
			return await processIfResultRules(aiResult)
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
			 * @returns {any} 编码后的提示。
			 */
			encode: prompt => prompt,
			/**
			 * 解码令牌。
			 * @param {any} tokens - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode: tokens => tokens,
			/**
			 * 解码单个令牌。
			 * @param {any} token - 要解码的令牌。
			 * @returns {string} 解码后的令牌。
			 */
			decode_single: token => token,
			/**
			 * 获取令牌计数。
			 * @param {string} prompt - 要计算令牌数的提示。
			 * @returns {Promise<number>} 令牌数。
			 */
			get_token_count: prompt => Promise.resolve(prompt.length)
		}
	}
	return result
}

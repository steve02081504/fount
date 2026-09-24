/**
 * If-Else 聚合源的条件选择与 BuildPrompt 委托（纯，无服务端依赖）。
 */
import { async_eval } from 'npm:@steve02081504/async-eval'

import { delegateBuildPrompt } from '../proxy/src/buildPromptDelegation.mjs'

/**
 * 从结构化提示提取用于条件判断的内容，对应 StructCall 的 chat_log 拼接。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {string} 拼接后的内容。
 */
export function promptStructContent(prompt_struct) {
	return prompt_struct.chat_log
		.map(entry => entry.content)
		.filter(Boolean)
		.join('\n')
}

/**
 * 创建按 if 规则顺序选择源的选择器。
 * @param {object} args - 参数。
 * @param {object[]} args.ifRules - if 规则列表。
 * @param {Map<string, object>} args.sourceMap - 规则 target 到内层源的映射。
 * @returns {(content: string, prompt_struct?: object) => Promise<object>} 选择器。
 */
export function createConditionSelector({ ifRules, sourceMap }) {
	return async (content, prompt_struct = null) => {
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
}

/**
 * 委托条件选中的内层源构建 prompt 结构；无匹配条件时返回空对象。
 * @param {string} content - 用于条件判断的内容。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @param {(content: string, prompt_struct?: object) => Promise<object>} selectSourceByCondition - 条件选择器。
 * @returns {Promise<object|unknown[]>} 构建结果。
 */
export async function buildPromptByCondition(content, prompt_struct, selectSourceByCondition) {
	try {
		const source = await selectSourceByCondition(content, prompt_struct)
		return await delegateBuildPrompt(source, prompt_struct)
	}
	catch (e) {
		console.error(e)
		return {}
	}
}

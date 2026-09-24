/**
 * 加权随机聚合源的选中与 BuildPrompt 委托（纯，无服务端依赖）。
 */
import { delegateBuildPrompt } from '../proxy/src/buildPromptDelegation.mjs'

/**
 * 按权重选择源，对应 StructCall 的加权随机选择。
 * @param {{weight: number, source: object}[]} weightedSources - 带权重的内层源。
 * @returns {object|undefined} 选中的源；权重和为零时返回 undefined。
 */
export function selectSourceByWeight(weightedSources) {
	const totalWeight = weightedSources.reduce((sum, s) => sum + s.weight, 0)
	let randomValue = Math.random() * totalWeight

	for (const weightedSource of weightedSources) {
		randomValue -= weightedSource.weight
		if (randomValue <= 0)
			return weightedSource.source
	}
}

/**
 * 委托加权随机选中的内层源构建 prompt 结构。
 * @param {{weight: number, source: object}[]} weightedSources - 带权重的内层源。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Promise<object|unknown[]>} 构建结果。
 */
export async function buildPromptByWeight(weightedSources, prompt_struct) {
	return delegateBuildPrompt(selectSourceByWeight(weightedSources), prompt_struct)
}

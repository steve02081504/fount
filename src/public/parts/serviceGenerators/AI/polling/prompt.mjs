/**
 * Polling 聚合源的轮询选择与 BuildPrompt 委托（纯，无服务端依赖）。
 */
import { delegateBuildPrompt } from '../proxy/src/buildPromptDelegation.mjs'

/**
 * 计算轮询的下一个索引，与 createPollingCall 的轮询步进一致。
 * @param {number} index - 当前索引。
 * @param {number} length - 源数量。
 * @returns {number} 下一个索引。
 */
export function advancePollingIndex(index, length) {
	return (index + 1) % length
}

/**
 * 从轮询列表中选出给定索引的源。
 * @param {object[]} sources - 内层 AI 源列表。
 * @param {number} index - 索引。
 * @returns {object|undefined} 选中的源；列表为空时为 undefined。
 */
export function pickPollingSource(sources, index) {
	return sources.length ? sources[index] : undefined
}

/**
 * 选出轮询的下一个目标源（不推进索引）。
 * @param {object[]} sources - 内层 AI 源列表。
 * @param {number} index - 当前索引。
 * @returns {object|undefined} 下一个目标源。
 */
export function nextPollingSource(sources, index) {
	return pickPollingSource(sources, advancePollingIndex(index, sources.length))
}

/**
 * 委托轮询选中的内层源构建 prompt 结构。
 * @param {object[]} sources - 内层 AI 源列表。
 * @param {number} index - 当前轮询索引。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Promise<object|unknown[]>} 构建结果。
 */
export async function buildPromptPolling(sources, index, prompt_struct) {
	return delegateBuildPrompt(nextPollingSource(sources, index), prompt_struct)
}

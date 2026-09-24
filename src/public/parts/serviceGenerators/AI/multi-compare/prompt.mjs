/**
 * Multi-Compare 聚合源的 BuildPrompt 委托（纯，无服务端依赖）。
 * 取首个内层源作为代表。
 */
import { delegateBuildPrompt } from '../proxy/src/buildPromptDelegation.mjs'

/**
 * 委托首个内层源构建 prompt 结构。
 * @param {object[]} sources - 内层 AI 源列表。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Promise<object|unknown[]>} 构建结果。
 */
export async function buildPromptFromFirstSource(sources, prompt_struct) {
	return delegateBuildPrompt(sources[0], prompt_struct)
}

/**
 * 包装/聚合 AI 源共用的 BuildPrompt 委托工具。
 * 内层源未实现可选方法 BuildPrompt 时返回空对象；否则直接透传结果（二进制保持 Buffer）。
 */

/**
 * 委托内层 AI 源构建出站 prompt 结构。
 * @param {object|undefined} source - 被选中的内层 AI 源。
 * @param {import('../../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Promise<object|unknown[]>} 构建结果；源缺失或未实现 BuildPrompt 时为空对象。
 */
export async function delegateBuildPrompt(source, prompt_struct) {
	if (!source?.BuildPrompt) return {}
	return await source.BuildPrompt(prompt_struct)
}

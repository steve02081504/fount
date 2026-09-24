/**
 * Fallback 聚合源的 BuildPrompt 委托（纯，无服务端依赖）。
 * 对应 StructCall 的按序故障转移：依次尝试各内层源，返回首个成功结果。
 */

/**
 * 依次委托各内层源构建 prompt，跳过未实现 BuildPrompt 或抛错的源。
 * @param {object[]} sources - 内层 AI 源列表。
 * @param {import('../../../../../decl/prompt_struct.ts').prompt_struct_t} prompt_struct - 结构化提示。
 * @returns {Promise<object|unknown[]>} 构建结果；全部不可用时为空对象。
 */
export async function buildPromptInOrder(sources, prompt_struct) {
	for (const source of sources) {
		if (!source?.BuildPrompt) continue
		try {
			return await source.BuildPrompt(prompt_struct)
		}
		catch (e) {
			console.error(e)
		}
	}
	return {}
}

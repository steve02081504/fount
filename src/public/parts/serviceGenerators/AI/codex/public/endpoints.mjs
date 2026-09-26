/**
 * 取得当前用户的 Codex 模型目录；这个接口不回传 OAuth 凭证。
 * @param {string} sourceName - Codex 服务源名称。
 * @returns {Promise<{models: Array<object>}>} 可选模型。
 */
export async function codexModels(sourceName) {
	const response = await fetch(`/api/parts/serviceGenerators:AI:codex/models?sourceName=${encodeURIComponent(sourceName)}`)
	const data = await response.json()
	if (!response.ok) throw new Error(data.message || response.statusText)
	return data
}

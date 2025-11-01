/**
 * @file AIsourceManage/public/src/endpoints.mjs
 * @description AI 源编辑器页面的 API 端点函数。
 * @namespace AIsourceManage.public.endpoints
 */

/**
 * @function getConfigTemplate
 * @memberof AIsourceManage.public.endpoints
 * @description 从服务器获取指定生成器的配置模板。
 * @param {string} generatorName - 生成器的名称。
 * @returns {Promise<object>} - 配置模板的 JSON 对象。
 */
export async function getConfigTemplate(generatorName) {
	const response = await fetch(`/api/shells/AIsourceManage/getConfigTemplate?${new URLSearchParams({ generator: generatorName })}`)
	return response.json()
}

/**
 * @function getConfigDisplay
 * @memberof AIsourceManage.public.endpoints
 * @description 获取生成器的显示配置（HTML 和 JS）。
 * @param {string} generatorName - 生成器的名称。
 * @returns {Promise<{html: string, js: string}>} - 包含 HTML 和 JS 的对象。
 */
export async function getConfigDisplay(generatorName) {
	if (!generatorName) return { html: '', js: '' }
	const response = await fetch(`/api/shells/AIsourceManage/getConfigDisplay?${new URLSearchParams({ generator: generatorName })}`)
	return response.json()
}

/**
 * @function getAIFile
 * @memberof AIsourceManage.public.endpoints
 * @description 从服务器获取指定的 AI 源文件内容。
 * @param {string} AISourceFile - AI 源文件的名称。
 * @returns {Promise<object>} - AI 源文件的 JSON 内容。
 */
export async function getAIFile(AISourceFile) {
	const response = await fetch(`/api/shells/AIsourceManage/getfile?${new URLSearchParams({ AISourceFile })}`)
	return response.json()
}

/**
 * @function setAIFile
 * @memberof AIsourceManage.public.endpoints
 * @description 将数据保存到服务器上的指定 AI 源文件。
 * @param {string} AISourceFile - AI 源文件的名称。
 * @param {object} data - 要保存的数据。
 * @returns {Promise<object>} - 服务器响应的 JSON 对象。
 */
export async function setAIFile(AISourceFile, data) {
	const response = await fetch('/api/shells/AIsourceManage/setfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile, data }),
	})
	return response.json()
}

/**
 * @function deleteAIFile
 * @memberof AIsourceManage.public.endpoints
 * @description 从服务器删除指定的 AI 源文件。
 * @param {string} AISourceFile - AI 源文件的名称。
 * @returns {Promise<object>} - 服务器响应的 JSON 对象。
 */
export async function deleteAIFile(AISourceFile) {
	const response = await fetch('/api/shells/AIsourceManage/deletefile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile }),
	})
	return response.json()
}

/**
 * @function addAIFile
 * @memberof AIsourceManage.public.endpoints
 * @description 在服务器上添加一个新的 AI 源文件。
 * @param {string} AISourceFile - 新 AI 源文件的名称。
 * @returns {Promise<object>} - 服务器响应的 JSON 对象。
 */
export async function addAIFile(AISourceFile) {
	const response = await fetch('/api/shells/AIsourceManage/addfile', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ AISourceFile }),
	})
	return response.json()
}

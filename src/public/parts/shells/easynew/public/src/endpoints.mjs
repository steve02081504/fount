/**
 * “轻松新建” shell 的客户端 API 端点。
 */

/**
 * 使用错误处理获取数据。
 * @param {string} url - URL。
 * @param {object} [options={}] - 选项。
 * @returns {Promise<any>} - 响应数据。
 */
async function fetchDataWithHandling(url, options = {}) {
	const response = await fetch(url, options)
	if (!response.ok) {
		const data = await response.json().catch(() => null)
		throw new Error(data?.error || `HTTP Error! status: ${response.status}`)
	}
	return response.json()
}

/**
 * 获取模板。
 * @returns {Promise<any>} - 模板。
 */
export async function getTemplates() {
	return fetchDataWithHandling('/api/parts/shells:easynew/templates')
}

/**
 * 获取模板 HTML。
 * @param {string} templateName - 模板名称。
 * @returns {Promise<any>} - 模板 HTML。
 */
export async function getTemplateHtml(templateName) {
	return fetchDataWithHandling(`/api/parts/shells:easynew/template-html?templateName=${encodeURIComponent(templateName)}`)
}

/**
 * 创建部件。
 * @param {FormData} formData - 表单数据。
 * @returns {Promise<any>} - 响应数据。
 */
export async function createPart(formData) {
	return fetchDataWithHandling('/api/parts/shells:easynew/create', {
		method: 'POST',
		body: formData,
	})
}

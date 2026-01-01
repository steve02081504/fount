/**
 * 从类型路径中提取类型名称。
 * @param {string} path - 路径（如 'serviceSources/AI'）。
 * @returns {string} - 类型名称（如 'AI'）。
 */
function extractType(path) {
	if (!path) return 'AI'
	const segments = path.split('/').filter(Boolean)
	return segments[segments.length - 1] || 'AI'
}

/**
 * API 基础路径。
 */
const API_BASE = '/api/parts/shells:serviceSourceManage'

/**
 * 从服务器获取指定生成器的配置模板。
 * @param {string} generatorName - 生成器的名称。
 * @param {string} sourceName - 服务源名称（可选，如果提供则从服务源获取配置）。
 * @param {string} serviceSourcePath - 服务源路径。
 * @returns {Promise<object>} - 配置模板的 JSON 对象。
 */
export async function getConfigTemplate(generatorName, sourceName, serviceSourcePath) {
	const type = extractType(serviceSourcePath)
	// 如果提供了服务源名称，尝试从服务源获取（可能包含额外配置）
	// 否则直接从生成器获取
	const url = sourceName
		? `${API_BASE}/${type}/${encodeURIComponent(sourceName)}/template${generatorName ? `?generator=${encodeURIComponent(generatorName)}` : ''}`
		: `${API_BASE}/${type}/generators/${encodeURIComponent(generatorName)}/template`
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to fetch config template: ${response.statusText}`)
	return response.json()
}

/**
 * 获取生成器的显示配置（HTML 和 JS）。
 * @param {string} generatorName - 生成器的名称。
 * @param {string} sourceName - 服务源名称（可选，如果提供则从服务源获取配置）。
 * @param {string} serviceSourcePath - 服务源路径。
 * @returns {Promise<{html: string, js: string}>} - 包含 HTML 和 JS 的对象。
 */
export async function getConfigDisplay(generatorName, sourceName, serviceSourcePath) {
	if (!generatorName) return { html: '', js: '' }
	const type = extractType(serviceSourcePath)
	// 如果提供了服务源名称，尝试从服务源获取（可能包含额外配置）
	// 否则直接从生成器获取
	const url = sourceName
		? `${API_BASE}/${type}/${encodeURIComponent(sourceName)}/display${generatorName ? `?generator=${encodeURIComponent(generatorName)}` : ''}`
		: `${API_BASE}/${type}/generators/${encodeURIComponent(generatorName)}/display`
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to fetch config display: ${response.statusText}`)
	return response.json()
}

/**
 * 从服务器获取指定的服务源文件内容。
 * @param {string} serviceSourceFile - 服务源的名称。
 * @param {string} serviceSourcePath - 服务源路径。
 * @returns {Promise<object>} - 服务源配置 JSON。
 */
export async function getServiceSourceFile(serviceSourceFile, serviceSourcePath) {
	const type = extractType(serviceSourcePath)
	const response = await fetch(`${API_BASE}/${type}/${encodeURIComponent(serviceSourceFile)}`)
	if (!response.ok) throw new Error(`Failed to fetch service source: ${response.statusText}`)
	return response.json()
}

/**
 * 将数据保存到服务器上的指定服务源。
 * @param {string} serviceSourceFile - 服务源名称。
 * @param {object} data - 要保存的数据。
 * @param {string} serviceSourcePath - 服务源路径。
 * @returns {Promise<object>} - 服务器响应的 JSON 对象。
 */
export async function setServiceSourceFile(serviceSourceFile, data, serviceSourcePath) {
	const type = extractType(serviceSourcePath)
	const response = await fetch(`${API_BASE}/${type}/${encodeURIComponent(serviceSourceFile)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: response.statusText }))
		throw new Error(error.error || `Failed to save service source: ${response.statusText}`)
	}
	return response.json()
}

/**
 * 从服务器删除指定的服务源。
 * @param {string} serviceSourceFile - 服务源名称。
 * @param {string} serviceSourcePath - 服务源路径。
 * @returns {Promise<object>} - 服务器响应的 JSON 对象。
 */
export async function deleteServiceSourceFile(serviceSourceFile, serviceSourcePath) {
	const type = extractType(serviceSourcePath)
	const response = await fetch(`${API_BASE}/${type}/${encodeURIComponent(serviceSourceFile)}`, {
		method: 'DELETE',
	})
	if (!response.ok) throw new Error(`Failed to delete service source: ${response.statusText}`)
	return response.json()
}

/**
 * 在服务器上添加一个新的服务源。
 * @param {string} serviceSourceFile - 服务源名称。
 * @param {string} serviceSourcePath - 服务源路径。
 * @returns {Promise<object>} - 服务器响应的 JSON 对象。
 */
export async function addServiceSourceFile(serviceSourceFile, serviceSourcePath) {
	const type = extractType(serviceSourcePath)
	const response = await fetch(`${API_BASE}/${type}/${encodeURIComponent(serviceSourceFile)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({}),
	})
	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: response.statusText }))
		throw new Error(error.error || `Failed to add service source: ${response.statusText}`)
	}
	return response.json()
}

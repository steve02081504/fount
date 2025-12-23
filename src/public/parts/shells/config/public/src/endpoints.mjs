/**
 * 获取部分类型列表
 */

/**
 * 获取配置数据
 * @param {string} partpath 部件路径
 * @returns {Promise<any>} 包含配置数据的 Promise。
 */
export async function getConfigData(partpath) {
	const response = await fetch(`/api/parts/shells:config/getdata?${new URLSearchParams({
		partpath,
	})}`)

	if (!response.ok) {
		const data = await response.json()
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
 * 保存配置
 * @param {string} partpath 部件路径
 * @param {object} data 配置数据
 * @returns {Promise<any>} 包含保存结果的 Promise。
 */
export async function saveConfigData(partpath, data) {
	const response = await fetch('/api/parts/shells:config/setdata', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			partpath,
			data
		}),
	})
	if (!response.ok) {
		const data = await response.json()
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
 * 获取部件的自定义显示内容
 * @param {string} partpath 部件路径
 * @returns {Promise<{html: string, js: string}>} 包含 HTML 和 JS 内容的 Promise。
 */
export async function getPartDisplay(partpath) {
	if (!partpath) return { html: '', js: '' }
	const response = await fetch(`/api/parts/shells:config/getPartDisplay?${new URLSearchParams({
		partpath
	})}`)
	if (!response.ok) {
		const data = await response.json()
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

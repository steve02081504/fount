
/**
 * 获取部分类型列表
 */

/**
 * 根据部分类型获取部分列表
 * @param {string} partType 部分类型
 */

/**
 * 根据部分类型和名称获取部分详情
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */

/**
 * 获取配置数据
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 * @returns {Promise<any>}
 */
export async function getConfigData(partType, partName) {
	const response = await fetch(`/api/shells/config/getdata?${new URLSearchParams({
		parttype: partType,
		partname: partName,
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
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 * @param {object} data 配置数据
 * @returns {Promise<any>}
 */
export async function saveConfigData(partType, partName, data) {
	const response = await fetch('/api/shells/config/setdata', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			parttype: partType,
			partname: partName,
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
 * @param {string} partType 部件类型
 * @param {string} partName 部件名称
 * @returns {Promise<{html: string, js: string}>}
 */
export async function getPartDisplay(partType, partName) {
	if (!partType || !partName) return { html: '', js: '' }
	const response = await fetch(`/api/shells/config/getPartDisplay?${new URLSearchParams({
		parttype: partType,
		partname: partName
	})}`)
	if (!response.ok) {
		const data = await response.json()
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

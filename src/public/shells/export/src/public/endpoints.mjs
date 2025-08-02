/**
 * 获取部分类型列表
 */
export async function getPartTypes() {
	const response = await fetch('/api/getparttypelist')
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
 * 根据部分类型获取部分列表
 * @param {string} partType 部分类型
 */
export async function getPartList(partType) {
	const response = await fetch(`/api/getlist/${partType}`)
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
 * 根据部分类型和名称获取部分详情
 * @param {string} partType 部分类型
 * @param {string} partName 部分名称
 */
export async function getPartDetails(partType, partName) {
	const response = await fetch(`/api/getdetails/${partType}?name=${partName}`)
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
 * 获取部件的 fount.json 内容
 * @param {string} partType 部件类型
 * @param {string} partName 部件名称
 * @returns {Promise<object>}
 */
export async function getFountJson(partType, partName) {
	const response = await fetch(`/api/shells/export/fountjson?partType=${partType}&partName=${partName}`)
	if (!response.ok) {
		const errorData = await response.json().catch(() => null)
		throw new Error(errorData?.message || `HTTP error! status: ${response.status}`)
	}
	return response.json()
}

/**
 * 导出部件
 * @param {string} partType 部件类型
 * @param {string} partName 部件名称
 * @param {boolean} withData 是否包含数据
 * @returns {Promise<Blob>}
 */
export async function exportPart(partType, partName, withData) {
	const response = await fetch(`/api/shells/export/export?partType=${partType}&partName=${partName}&withData=${withData}`)
	if (!response.ok) {
		const errorData = await response.json().catch(() => null)
		throw new Error(errorData?.message || `HTTP error! status: ${response.status}`)
	}
	return response.blob()
}

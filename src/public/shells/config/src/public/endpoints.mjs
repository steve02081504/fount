/**
 * 获取部分类型列表
 */
export async function getPartTypes() {
	const response = await fetch('/api/getparttypelist')
	if (!response.ok) {
		const data = await response.json()
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
   * 根据部分类型获取部分列表
   * @param {string} partType 部分类型
   */
export async function getParts(partType) {
	const response = await fetch(`/api/getlist/${partType}`)
	if (!response.ok) {
		const data = await response.json()
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
		const data = await response.json()
		const errorMsg = data.error || data.message || `HTTP error! status: ${response.status}`
		throw new Error(errorMsg)
	}
	return response.json()
}

/**
   * 获取配置数据
   * @param {string} partType 部分类型
   * @param {string} partName 部分名称
   */
export async function getConfigData(partType, partName) {
	const response = await fetch('/api/shells/config/getdata', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ parttype: partType, partname: partName }),
	})
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

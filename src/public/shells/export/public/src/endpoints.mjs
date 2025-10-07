
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

	const contentDisposition = response.headers.get('Content-Disposition')
	let format = 'zip'
	if (contentDisposition) {
		const match = /filename\*=\S+''[^.]+\.(.+)|filename="[^.]+\.(.+)"/.exec(contentDisposition)
		if (match) format = match[1] || match[2]
	}

	const blob = await response.blob()
	return { blob, format }
}

/**
 * 创建分享链接
 * @param {string} partType 部件类型
 * @param {string} partName 部件名称
 * @param {string} expiration 过期时间
 * @param {boolean} withData 是否包含数据
 * @returns {Promise<string>}
 */
export async function createShareLink(partType, partName, expiration, withData) {
	const response = await fetch('/api/shells/export/share', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ partType, partName, expiration, withData }),
	})
	if (!response.ok) {
		const errorData = await response.json().catch(() => null)
		throw new Error(errorData?.message || `HTTP error! status: ${response.status}`)
	}
	const { link } = await response.json()
	return link
}

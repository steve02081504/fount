/**
 * 导出 shell 的客户端 API 端点。
 */

/**
 * 获取部件的 fount.json 内容。
 * @param {string} partpath - 部件路径。
 * @returns {Promise<object>} - fount.json 的内容。
 */
export async function getFountJson(partpath) {
	const response = await fetch(`/api/parts/shells:export/fountjson?partpath=${encodeURIComponent(partpath)}`)
	if (!response.ok) {
		const errorData = await response.json().catch(() => null)
		throw new Error(errorData?.message || `HTTP error! status: ${response.status}`)
	}
	return response.json()
}

/**
 * 导出部件。
 * @param {string} partpath - 部件路径。
 * @param {boolean} withData - 是否包含数据。
 * @returns {Promise<{blob: Blob, format: string}>} - 包含 blob 和格式的对象。
 */
export async function exportPart(partpath, withData) {
	const response = await fetch(`/api/parts/shells:export/export?partpath=${encodeURIComponent(partpath)}&withData=${withData}`)
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
 * 创建分享链接。
 * @param {string} partpath - 部件路径。
 * @param {string} expiration - 过期时间。
 * @param {boolean} withData - 是否包含数据。
 * @returns {Promise<string>} - 分享链接。
 */
export async function createShareLink(partpath, expiration, withData) {
	const response = await fetch('/api/parts/shells:export/share', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ partpath, expiration, withData }),
	})
	if (!response.ok) {
		const errorData = await response.json().catch(() => null)
		throw new Error(errorData?.message || `HTTP error! status: ${response.status}`)
	}
	const { link } = await response.json()
	return link
}

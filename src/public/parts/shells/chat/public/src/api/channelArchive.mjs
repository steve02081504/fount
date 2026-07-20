/**
 * 【文件】public/src/api/channelArchive.mjs
 * 【职责】频道归档 REST：导出下载、multipart 导入。
 * 【关联】channelContextMenu、groupSettings/generalTab；后端 channelArchive 路由。
 */

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<object>} 归档 JSON
 */
export async function exportChannelArchiveJson(groupId, channelId) {
	const response = await fetch(
		`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/export`,
		{ credentials: 'include' },
	)
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || `HTTP ${response.status}`), data)
	}
	return response.json()
}

/**
 * @param {object} archive 归档对象
 * @param {string} fileName 下载文件名
 * @returns {void}
 */
export function downloadChannelArchiveJson(archive, fileName) {
	const blob = new Blob([JSON.stringify(archive, null, '\t')], { type: 'application/json' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = fileName
	a.click()
	URL.revokeObjectURL(url)
}

/**
 * @param {string} groupId 群 ID
 * @param {File} file JSON 文件
 * @param {{ name?: string }} [options] 可选频道名
 * @returns {Promise<{ channelId: string, messageCount: number }>} 导入结果
 */
export async function importChannelArchiveFile(groupId, file, options = {}) {
	const form = new FormData()
	form.append('archive', file, file.name || 'channel-archive.json')
	if (options.name) form.append('name', options.name)
	const response = await fetch(
		`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/import`,
		{ method: 'POST', credentials: 'include', body: form },
	)
	if (!response.ok) {
		const data = await response.json().catch(() => ({}))
		throw Object.assign(new Error(data.error || `HTTP ${response.status}`), data)
	}
	return response.json()
}

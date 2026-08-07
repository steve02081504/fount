/**
 * 【文件】public/src/endpoints/channelArchive.mjs
 * 【职责】频道归档 REST：导出下载、multipart 导入。
 * 【关联】channelContextMenu、groupSettings/generalTab；后端 channelArchive 路由。
 */
import { chatFetch, groupPath } from './groupClient.mjs'

/**
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<object>} 归档 JSON
 */
export async function exportChannelArchiveJson(groupId, channelId) {
	return chatFetch(`/groups/${groupPath(groupId, 'channels', channelId, 'export')}`)
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
	return chatFetch(`/groups/${groupPath(groupId, 'channels', 'import')}`, {
		method: 'POST',
		body: form,
	})
}

/**
 * 拉取群冷归档存储摘要（按频道/月份分布）。
 * @param {string} groupId 群 ID
 * @returns {Promise<{ files: { channelId: string, month: string, bytes: number }[] }>} 归档摘要
 */
export async function getArchiveSummary(groupId) {
	return chatFetch(`/groups/${groupPath(groupId, 'archive', 'summary')}`)
}

/**
 * 删除指定月份之前的冷归档文件。
 * @param {string} groupId 群 ID
 * @param {string} beforeMonth `YYYY-MM`
 * @returns {Promise<{ deletedFiles: number }>} 删除结果
 */
export async function deleteArchiveBefore(groupId, beforeMonth) {
	return chatFetch(`/groups/${groupPath(groupId, 'archive')}?before=${encodeURIComponent(beforeMonth)}`, {
		method: 'DELETE',
	})
}

/**
 * 触发一次冷归档补齐同步（向对等节点请求缺失月份）。
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function syncArchive(groupId) {
	await chatFetch(`/groups/${groupPath(groupId, 'archive', 'sync')}`, { method: 'POST' })
}

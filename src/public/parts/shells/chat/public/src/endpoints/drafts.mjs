import { chatFetch } from './groupClient.mjs'

/**
 * 构造频道草稿键。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} `groupId:channelId`
 */
export function draftKey(groupId, channelId) {
	return `${groupId}:${channelId}`
}

/**
 * 读取某频道草稿（元数据 + 附件缩略图，不含附件完整内容）。
 * @param {string} key 频道草稿键
 * @returns {Promise<object | null>} 草稿记录或 null
 */
export async function getDraft(key) {
	const data = await chatFetch(`/drafts/${encodeURIComponent(key)}`, { method: 'GET' })
	return data.channel || null
}

/**
 * 保存/更新频道草稿（附件含缩略图，必要时带完整内容 buffer）。
 * @param {string} key 频道草稿键
 * @param {object} record 草稿记录
 * @returns {Promise<object | null>} 落盘后的草稿记录
 */
export async function saveDraft(key, record) {
	const data = await chatFetch(`/drafts/${encodeURIComponent(key)}`, {
		method: 'PUT',
		json: record,
	})
	return data.channel || null
}

/**
 * 删除频道草稿及其附件内容。
 * @param {string} key 频道草稿键
 * @returns {Promise<void>} 无
 */
export async function deleteDraft(key) {
	await chatFetch(`/drafts/${encodeURIComponent(key)}`, { method: 'DELETE' })
}

/**
 * 懒拉取某草稿附件的完整内容（base64）。
 * @param {string} key 频道草稿键
 * @param {string} fileId 附件 ID
 * @returns {Promise<string>} base64 内容
 */
export async function getDraftFileContent(key, fileId) {
	const data = await chatFetch(
		`/drafts/${encodeURIComponent(key)}/files/${encodeURIComponent(fileId)}`,
		{ method: 'GET' },
	)
	return data.buffer
}

/**
 * 确保附件对象已持有完整内容（草稿恢复的附件无 buffer 时懒拉取）。
 * @param {object} file 附件对象（含 draftKey 与 fileId）
 * @returns {Promise<object>} 已加载 buffer 的附件对象
 */
export async function ensureDraftFileContent(file) {
	if (typeof file.buffer === 'string' || !file.draftKey || !file.fileId) return file
	file.buffer = await getDraftFileContent(file.draftKey, file.fileId)
	return file
}

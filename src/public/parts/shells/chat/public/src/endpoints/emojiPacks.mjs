/**
 * 【文件】public/src/endpoints/emojiPacks.mjs
 * 【职责】群表情包 CRUD：包列表/详情、建包、上传/删除表情。
 * 【关联】groupSettings/emojisTab.mjs；后端 group/emoji-packs 路由。
 */
import { groupFetch, groupPath } from './groupClient.mjs'

/**
 * 拉取群下所有表情包摘要。
 * @param {string} groupId 群 ID
 * @returns {Promise<object[]>} 表情包列表
 */
export async function listGroupEmojiPacks(groupId) {
	const data = await groupFetch(groupPath(groupId, 'emoji-packs'), { method: 'GET' })
	return Array.isArray(data.packs) ? data.packs : []
}

/**
 * 拉取单个表情包详情（含表情条目）。
 * @param {string} groupId 群 ID
 * @param {string} packId 包 ID
 * @returns {Promise<object|null>} 表情包详情
 */
export async function getGroupEmojiPack(groupId, packId) {
	const data = await groupFetch(groupPath(groupId, 'emoji-packs', packId), { method: 'GET' })
	return data.pack || null
}

/**
 * 创建新表情包。
 * @param {string} groupId 群 ID
 * @param {string} packId 包 ID
 * @returns {Promise<object>} `{ pack }`
 */
export function createGroupEmojiPack(groupId, packId) {
	return groupFetch(groupPath(groupId, 'emoji-packs'), { method: 'POST', json: { packId } })
}

/**
 * 上传表情到指定包。
 * @param {string} groupId 群 ID
 * @param {string} packId 包 ID
 * @param {File} file 表情图片
 * @param {string} name 表情名
 * @returns {Promise<object>} 服务端响应
 */
export function uploadGroupEmoji(groupId, packId, file, name) {
	const form = new FormData()
	form.append('emoji', file)
	form.append('name', name)
	return groupFetch(groupPath(groupId, 'emoji-packs', packId, 'emojis'), { method: 'POST', body: form })
}

/**
 * 从指定包删除表情。
 * @param {string} groupId 群 ID
 * @param {string} packId 包 ID
 * @param {string} emojiId 表情 ID
 * @returns {Promise<void>}
 */
export async function deleteGroupEmoji(groupId, packId, emojiId) {
	await groupFetch(groupPath(groupId, 'emoji-packs', packId, 'emojis', emojiId), { method: 'DELETE' })
}

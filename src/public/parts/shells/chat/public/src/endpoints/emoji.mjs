/**
 * 【文件】public/src/endpoints/emoji.mjs
 * 【职责】emoji-usage / emoji-packs / group preview REST。
 */
import { chatFetch, groupFetch, groupPath } from './groupClient.mjs'

/**
 * @returns {Promise<object>} emoji-usage 载荷
 */
export async function getEmojiUsage() {
	try {
		return await chatFetch('/emoji-usage')
	}
	catch {
		return { log: [], lastUsedAtByPack: {}, collection: { packIds: [], emojiIds: [] } }
	}
}

/**
 * @param {string} [groupId] 群 ID
 * @returns {Promise<object[]>} packs
 */
export async function listEmojiPacks(groupId) {
	const q = groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''
	try {
		const data = await chatFetch(`/emoji-packs${q}`)
		return Array.isArray(data.packs) ? data.packs : []
	}
	catch {
		return []
	}
}

/**
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} preview
 */
export function getGroupPreview(groupId) {
	return groupFetch(groupPath(groupId, 'preview'))
}

/**
 * @param {number} [limit=48] 数量
 * @returns {Promise<object[]>} offers
 */
export async function discoverEmojiPacks(limit = 48) {
	try {
		const data = await chatFetch(`/emoji-packs/discover?limit=${encodeURIComponent(limit)}`)
		return data.offers || []
	}
	catch {
		return []
	}
}

/**
 * @param {object} item 选中项
 * @returns {Promise<void>}
 */
export function recordEmojiUsage(item) {
	return chatFetch('/emoji-usage/record', { method: 'POST', json: item })
}

/**
 * @param {string} packId 包 ID
 * @returns {Promise<object>} collection
 */
export async function addEmojiCollectionPack(packId) {
	const data = await chatFetch('/emoji-usage/collection/packs', { method: 'POST', json: { packId } })
	return data.collection || data
}

/**
 * @param {string} packId 包 ID
 * @returns {Promise<object>} collection
 */
export async function removeEmojiCollectionPack(packId) {
	const data = await chatFetch(`/emoji-usage/collection/packs/${encodeURIComponent(packId)}`, { method: 'DELETE' })
	return data.collection || data
}

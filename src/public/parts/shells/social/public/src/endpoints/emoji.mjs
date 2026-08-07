/** Social emoji pack（已关注作者个人包）：可用列表与发现。 */
import { SOCIAL_BASE, socialRequest } from './client.mjs'

/**
 * @param {string} entityHash 作者
 * @param {string} packId 包 id
 * @returns {string} 包内容 URL（无 vaultPath 时的预览回退）
 */
export function emojiPackItemUrl(entityHash, packId) {
	return `${SOCIAL_BASE}/emoji-packs/${encodeURIComponent(entityHash)}/${encodeURIComponent(packId || '')}`
}

/**
 * 已关注作者的可用 emoji 包。
 * @returns {Promise<object[]>} 已关注作者的可用包
 */
export async function getAvailableEmojiPacks() {
	const data = await socialRequest('/emoji-packs/available')
	return data.packs
}

/**
 * 发现可关注作者的 emoji 包 offers。
 * @param {number} [limit=48] 数量
 * @returns {Promise<object[]>} 可发现的 offers
 */
export async function discoverEmojiPacks(limit = 48) {
	const data = await socialRequest(`/emoji-packs/discover?limit=${encodeURIComponent(limit)}`)
	return data.offers
}

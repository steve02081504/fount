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
 * @returns {Promise<object[]>} 已关注作者的可用包
 */
export async function getAvailableEmojiPacks() {
	try {
		const data = await socialRequest('/emoji-packs/available')
		return Array.isArray(data.packs) ? data.packs : []
	}
	catch {
		return []
	}
}

/**
 * @param {number} [limit=48] 数量
 * @returns {Promise<object[]>} 可发现的 offers
 */
export async function discoverEmojiPacks(limit = 48) {
	try {
		const data = await socialRequest(`/emoji-packs/discover?limit=${encodeURIComponent(limit)}`)
		return data.offers || []
	}
	catch {
		return []
	}
}

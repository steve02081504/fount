/**
 * Chat sticker 内容提供商（registries.sticker）：收藏贴纸包聚合。
 */

/**
 * @param {string} url 贴纸资源 URL
 * @returns {Promise<{ stickerBase64: string, mimeType: string }>} DAG 内联载荷
 */
export async function fetchStickerPayload(url) {
	const response = await fetch(url, { credentials: 'include' })
	if (!response.ok) throw new Error(`sticker fetch ${response.status}`)
	const blob = await response.blob()
	const mimeType = blob.type || 'image/png'
	const bytes = new Uint8Array(await response.arrayBuffer())
	if (bytes.length > 240_000) throw new Error('sticker file too large for DAG inline')
	return { stickerBase64: btoa(String.fromCharCode(...bytes)), mimeType }
}

/**
 * @param {object} [context] picker 上下文（未使用）
 * @returns {Promise<{ stickers: object[], showMarketLink?: boolean }>} 贴纸列表与空态提示
 */
async function loadStickers(context) {
	void context
	const collResp = await fetch('/api/parts/shells:chat/stickers/collection', { credentials: 'include' })
	if (!collResp.ok) throw new Error('Failed')
	const collData = await collResp.json()
	const installedPacks = collData.collection?.installedPacks || []
	if (!installedPacks.length)
		return { stickers: [], showMarketLink: true }

	/** @type {object[]} */
	const allStickers = []
	for (const packId of installedPacks)
		try {
			const packResp = await fetch(
				`/api/parts/shells:chat/stickers/packs/${encodeURIComponent(packId)}`,
				{ credentials: 'include' },
			)
			if (!packResp.ok) continue
			const packData = await packResp.json()
			if (packData.pack?.stickers)
				allStickers.push(...packData.pack.stickers)
		}
		catch { /* skip pack */ }

	if (!allStickers.length)
		return { stickers: [], showMarketLink: false }

	return {
		stickers: allStickers.map(sticker => ({
			id: sticker.id,
			stickerId: sticker.id,
			label: sticker.name || sticker.id,
			previewUrl: sticker.url || '',
			stickerUrl: sticker.url || '',
			name: sticker.name || sticker.id,
		})),
	}
}

/**
 * @param {object} context picker 上下文
 * @returns {Promise<object[]>} 贴纸包列表（单 collection 包）
 */
async function listPacks(context) {
	const { stickers } = await loadStickers(context)
	return [{
		id: 'collection',
		label: 'Stickers',
		items: stickers,
	}]
}

/**
 * @param {object} item 贴纸项
 * @returns {string} 插入编辑器的 token
 */
function tokenForSelection(item) {
	return item.token || (item.stickerId ? `:[sticker/${item.stickerId}]:` : '')
}

/** Chat sticker registry 提供商 */
export default {
	kind: 'sticker',
	loadStickers,
	listPacks,
	tokenForSelection,
	fetchStickerPayload,
}

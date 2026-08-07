/**
 * Social emoji pack 提供商（registries.emoji）：已关注作者的个人包。
 */
import { primaryLocale, loadPreferredLangs } from '/scripts/i18n/index.mjs'
import { resolveEmojiItemLabels, resolvePackPresentation } from '/scripts/features/emoji/packPresentation.mjs'
import { entityFileUrl } from '/parts/shells:chat/shared/evfsMedia.mjs'
import { formatEmojiToken } from '/parts/shells:chat/shared/inlineTokenSyntax.mjs'
import {
	discoverEmojiPacks,
	emojiPackItemUrl,
	getAvailableEmojiPacks,
} from '../src/endpoints/emoji.mjs'

/**
 * @param {object} item pack item
 * @param {string} entityHash 作者
 * @returns {string} 预览 URL
 */
function itemPreviewUrl(item, entityHash) {
	if (item.vaultPath && entityHash)
		return entityFileUrl(entityHash, item.vaultPath)
	if (item.previewUrl) return item.previewUrl
	return emojiPackItemUrl(entityHash, item.packId || '')
}

/**
 * Social shell emoji registry provider（已关注作者的个人包）。
 */
export default {
	kind: 'emoji',

	/**
	 * @param {object} context picker 上下文
	 * @returns {Promise<object[]>} 规范化 pack 列表
	 */
	async listPacks(context = {}) {
		void context
		const locales = loadPreferredLangs().length ? loadPreferredLangs() : [primaryLocale()]
		const packs = await getAvailableEmojiPacks()
		return packs.map(pack => {
			const entityHash = pack.entityHash || pack.source?.id
			const presentation = resolvePackPresentation(pack, locales, pack.infoDefaults || {})
			const items = (pack.items || []).map(entry => {
				const labels = resolveEmojiItemLabels(entry, locales)
				const packId = pack.packId
				const emojiId = entry.emojiId
				return {
					kind: 'pack',
					packId,
					emojiId,
					emojiRef: formatEmojiToken(packId, emojiId),
					name: labels.name,
					alt: labels.alt,
					label: labels.name,
					previewUrl: itemPreviewUrl({ ...entry, packId }, entityHash),
					animated: !!entry.animated,
					entityHash,
				}
			})
			return {
				packId: pack.packId,
				source: pack.source || { kind: 'entity', id: entityHash },
				entityHash,
				defaultEmojiPackId: pack.defaultEmojiPackId,
				isDefault: pack.defaultEmojiPackId === pack.packId,
				localized: pack.localized,
				infoDefaults: pack.infoDefaults,
				name: presentation.name,
				avatar: presentation.avatar,
				items,
			}
		})
	},

	/**
	 * @param {string} packId 包 id
	 * @param {string} emojiId 表情 id
	 * @param {object} [item] 可选条目（含 vaultPath）
	 * @returns {string} 内容 URL
	 */
	packContentUrl(packId, emojiId, item) {
		void packId
		void emojiId
		const entityHash = item?.entityHash || item?.source?.id
		if (item?.vaultPath && entityHash)
			return entityFileUrl(entityHash, item.vaultPath)
		return null
	},

	/**
	 * @param {object} pack pack
	 * @returns {Promise<object | null>} 来源预览
	 */
	async packSourcePreview(pack) {
		const entityHash = pack?.source?.kind === 'entity' ? pack.source.id : pack?.entityHash
		if (!entityHash) return null
		return { kind: 'entity', entityHash, pack }
	},

	/**
	 * @param {{ limit?: number }} [options] 选项
	 * @returns {Promise<object[]>} 发现 offers
	 */
	async discoverPacks(options = {}) {
		const locales = loadPreferredLangs().length ? loadPreferredLangs() : [primaryLocale()]
		const offers = await discoverEmojiPacks(options.limit || 48)
		return offers.map(offer => {
			const entityHash = offer.sourceId
			const presentation = resolvePackPresentation(offer, locales, offer.infoDefaults || {})
			return {
				packId: offer.packId,
				source: { kind: 'entity', id: entityHash },
				entityHash,
				localized: offer.localized,
				infoDefaults: offer.infoDefaults,
				itemCount: offer.itemCount,
				name: presentation.name,
				avatar: presentation.avatar,
				description: presentation.description,
				tags: presentation.tags,
				links: presentation.links,
			}
		})
	},
}

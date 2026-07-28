/**
 * 聚合各 emoji provider 的 discoverPacks。
 */
import { listEmojiProviders } from './providers.mjs'

/**
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<object[]>} 发现 offers（已附 _provider）
 */
export async function discoverEmojiPackOffers(options = {}) {
	const providers = await listEmojiProviders()
	/** @type {object[]} */
	const offers = []
	const seen = new Set()
	for (const provider of providers) {
		if (!provider.discoverPacks) continue
		try {
			const list = await provider.discoverPacks(options)
			for (const offer of list || []) {
				const packId = offer?.packId
				const sourceId = offer?.source?.id || offer?.sourceId || offer?.groupId || offer?.entityHash
				if (!packId || !sourceId) continue
				const key = `${offer.source?.kind || offer.sourceKind || '?'}:${sourceId}:${packId}`
				if (seen.has(key)) continue
				seen.add(key)
				offers.push({ ...offer, _provider: provider })
			}
		}
		catch (error) {
			console.warn('[emoji] provider.discoverPacks failed', provider, error)
		}
	}
	return offers
}

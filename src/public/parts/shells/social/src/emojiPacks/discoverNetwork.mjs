/**
 * 作者表情包发现：part_query(`emoji_pack_offers`)。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork } from 'npm:@steve02081504/fount-p2p/wire/part/query'

/** 联邦表情包容器发现查询种类。 */
export const EMOJI_PACK_OFFERS_KIND = 'emoji_pack_offers'

/**
 * @param {unknown} raw 行
 * @returns {object | null} 清洗后 offer
 */
export function sanitizeAuthorPackOffer(raw) {
	if (!raw || typeof raw !== 'object') return null
	const packId = String(/** @type {{ packId?: unknown }} */raw.packId || '').trim()
	const sourceId = String(/** @type {{ sourceId?: unknown }} */raw.sourceId || '').trim()
	if (!packId || !sourceId) return null
	const localized = /** @type {{ localized?: unknown }} */raw.localized
	return {
		packId,
		sourceKind: 'entity',
		sourceId,
		localized: localized && typeof localized === 'object' ? localized : {},
		itemCount: Math.min(Math.max(Number(/** @type {{ itemCount?: unknown }} */raw.itemCount) || 0, 0), 10_000),
		infoDefaults: /** @type {{ infoDefaults?: object }} */raw.infoDefaults && typeof raw.infoDefaults === 'object'
			? raw.infoDefaults
			: {},
		nodeHash: String(/** @type {{ nodeHash?: unknown }} */raw.nodeHash || '').trim().slice(0, 128),
	}
}

/**
 * 本机应答：visibility=public 的作者包。
 * @param {{ replicaUsername?: string }} inboundContext 入站
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} offers
 */
export async function localAuthorPackOffersHandler(inboundContext, query) {
	const username = String(inboundContext.replicaUsername || '').trim()
	if (!username) return []
	const limit = Math.min(Math.max(Number(
		query && typeof query === 'object' ? /** @type {{ limit?: unknown }} */query.limit : 32,
	) || 32, 1), 64)
	const nodeHash = String(getNodeHash() || '')
	const { userEntitiesRoot } = await import('../../../chat/src/chat/lib/paths.mjs')
	const { getProfile } = await import('../../../chat/src/entity/profile.mjs')
	const { listLocalEntityPacks } = await import('../emojiPacks.mjs')
	const fs = await import('node:fs/promises')

	const entitiesRoot = userEntitiesRoot(username)
	/** @type {string[]} */
	let entityHashes = []
	try {
		entityHashes = await fs.readdir(entitiesRoot)
	}
	catch {
		return []
	}

	/** @type {object[]} */
	const offers = []
	for (const entityHash of entityHashes) {
		if (offers.length >= limit) break
		let packs = []
		try {
			packs = await listLocalEntityPacks(username, entityHash)
		}
		catch {
			packs = []
		}
		const profile = await getProfile(entityHash, username, { fetchRemote: false }).catch(() => null)
		const infoDefaults = {
			name: String(profile?.name || entityHash.slice(0, 8)),
			avatar: profile?.avatar || null,
			description: profile?.description || '',
		}
		for (const pack of packs) {
			if (offers.length >= limit) break
			if (String(pack.visibility || 'followers') !== 'public') continue
			offers.push({
				packId: pack.packId,
				sourceKind: 'entity',
				sourceId: entityHash,
				localized: pack.localized || {},
				itemCount: Array.isArray(pack.items) ? pack.items.length : 0,
				infoDefaults,
				nodeHash,
			})
		}
	}
	return offers
}

/**
 * 聚合本机与邻居的公开作者包 offers。
 * @param {string} username 用户
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<{ offers: object[], scope: 'nearby' }>} 附近作者包 offers
 */
export async function buildNearbyAuthorPackOffers(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 48, 1), 96)
	const rows = await queryNetwork(username, getShellPartpath('social'), EMOJI_PACK_OFFERS_KIND, { limit }, {
		maxHits: 128,
		/**
		 * @param {unknown} row 行
		 * @returns {string} 去重键
		 */
		rowKey: row => {
			const cleaned = sanitizeAuthorPackOffer(row)
			if (!cleaned) return ''
			return `${cleaned.sourceId}:${cleaned.packId}`
		},
	})

	/** @type {object[]} */
	const offers = []
	const seen = new Set()
	for (const raw of rows) {
		const offer = sanitizeAuthorPackOffer(raw)
		if (!offer) continue
		const key = `${offer.sourceId}:${offer.packId}`
		if (seen.has(key)) continue
		seen.add(key)
		offers.push(offer)
		if (offers.length >= limit) break
	}
	return { offers, scope: 'nearby' }
}

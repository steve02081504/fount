/**
 * 公开群表情包发现：part_query(`emoji_pack_offers`)。
 */
import { getNodeHash } from 'npm:@steve02081504/fount-p2p/node/identity'
import { getShellPartpath } from 'npm:@steve02081504/fount-p2p/registries/part_path'
import { queryNetwork, registerQueryInboundHandler } from 'npm:@steve02081504/fount-p2p/wire/part/query'

/** part_query 类型：emoji 包发现。 */
export const EMOJI_PACK_OFFERS_KIND = 'emoji_pack_offers'

/**
 * @param {unknown} raw 行
 * @returns {object | null} 清洗后 offer
 */
export function sanitizeEmojiPackOffer(raw) {
	if (!raw || typeof raw !== 'object') return null
	const packId = String(/** @type {{ packId?: unknown }} */raw.packId || '').trim()
	const sourceId = String(/** @type {{ sourceId?: unknown }} */raw.sourceId || '').trim()
	if (!packId || !sourceId) return null
	const sourceKind = String(/** @type {{ sourceKind?: unknown }} */raw.sourceKind || 'group').trim() || 'group'
	const itemCount = Math.min(Math.max(Number(/** @type {{ itemCount?: unknown }} */raw.itemCount) || 0, 0), 10_000)
	const localized = /** @type {{ localized?: unknown }} */raw.localized
	const nodeHashRaw = String(/** @type {{ nodeHash?: unknown }} */raw.nodeHash || '').trim().slice(0, 128)
	const nodeHash = /^[\da-f]+$/u.test(nodeHashRaw) ? nodeHashRaw : ''
	return {
		packId,
		sourceKind,
		sourceId,
		localized: localized && typeof localized === 'object' ? localized : {},
		itemCount,
		infoDefaults: /** @type {{ infoDefaults?: object }} */raw.infoDefaults && typeof raw.infoDefaults === 'object'
			? raw.infoDefaults
			: {},
		joinPolicy: String(/** @type {{ joinPolicy?: unknown }} */raw.joinPolicy || '').trim() || null,
		nodeHash,
	}
}

/**
 * 本机应答：已加入且 discoveryPublic 的群包。
 * @param {{ replicaUsername?: string }} inboundContext 入站
 * @param {unknown} query 查询
 * @returns {Promise<object[]>} offers
 */
export async function localGroupPackOffersHandler(inboundContext, query) {
	const username = (inboundContext.replicaUsername || '')
	if (!username) return []
	const limit = Math.min(Math.max(Number(
		query && typeof query === 'object' ? /** @type {{ limit?: unknown }} */query.limit : 32,
	) || 32, 1), 64)
	const nodeHash = String(getNodeHash() || '')
	const { listUserGroups } = await import('../chat/lib/userGroups.mjs')
	const { getState } = await import('../chat/dag/materialize.mjs')
	const { resolveActiveMemberKeyForLocalReplica } = await import('../group/access.mjs')
	const { listGroupPacks } = await import('../group/groupEmojis.mjs')

	const groupIds = await listUserGroups(username)
	const settled = await Promise.all(groupIds.map(async groupId => {
		let state
		try {
			({ state } = await getState(username, groupId, { skipLeftPurge: true }))
		}
		catch {
			return []
		}
		if (!state?.groupSettings?.discoveryPublic) return []
		const memberKey = await resolveActiveMemberKeyForLocalReplica(username, groupId, state)
		if (!memberKey) return []

		const infoDefaults = {
			name: state.groupMeta?.name || groupId,
			avatar: state.groupMeta?.avatar ?? null,
			description: state.groupMeta?.description || state.groupSettings?.discoveryBlurb || '',
		}
		const joinPolicy = state.groupSettings?.joinPolicy || 'invite-only'
		const packs = await listGroupPacks(username, groupId)
		return packs.map(pack => ({
			packId: pack.packId,
			sourceKind: 'group',
			sourceId: groupId,
			localized: pack.localized || {},
			itemCount: Array.isArray(pack.items) ? pack.items.length : 0,
			infoDefaults,
			joinPolicy,
			nodeHash,
		}))
	}))
	return settled.flat().slice(0, limit)
}

/**
 * 聚合本机与邻居的公开群包 offers。
 * @param {string} username 用户
 * @param {{ limit?: number }} [options] 选项
 * @returns {Promise<{ offers: object[], scope: 'nearby' }>} 附近群包 offers
 */
export async function buildNearbyGroupPackOffers(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 48, 1), 96)
	const partpath = getShellPartpath('chat')
	const rows = await queryNetwork(username, partpath, EMOJI_PACK_OFFERS_KIND, { limit }, {
		maxHits: 128,
		/**
		 * @param {unknown} row 行
		 * @returns {string} 去重键
		 */
		rowKey: row => {
			const cleaned = sanitizeEmojiPackOffer(row)
			if (!cleaned) return ''
			return `${cleaned.sourceKind}:${cleaned.sourceId}:${cleaned.packId}`
		},
	})

	/** @type {object[]} */
	const offers = []
	const seen = new Set()
	for (const raw of rows) {
		const offer = sanitizeEmojiPackOffer(raw)
		if (!offer || offer.sourceKind !== 'group') continue
		const key = `${offer.sourceId}:${offer.packId}`
		if (seen.has(key)) continue
		seen.add(key)
		offers.push(offer)
		if (offers.length >= limit) break
	}
	return { offers, scope: 'nearby' }
}

/**
 * Chat Load：注册 emoji_pack_offers part_query。
 * @returns {void}
 */
export function registerChatEmojiPackOffersHandler() {
	registerQueryInboundHandler(getShellPartpath('chat'), EMOJI_PACK_OFFERS_KIND, localGroupPackOffersHandler)
}

/**
 * Chat Unload：清空 handler。
 * @returns {void}
 */
export function unregisterChatEmojiPackOffersHandler() {
	registerQueryInboundHandler(getShellPartpath('chat'), EMOJI_PACK_OFFERS_KIND, () => [])
}

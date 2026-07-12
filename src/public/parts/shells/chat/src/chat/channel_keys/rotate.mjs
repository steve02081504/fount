import { generateChannelKey, wrapChannelKey } from 'npm:@steve02081504/fount-p2p/crypto/channel'
import { HEX_ID_64 as PUB_KEY_HEX_64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { calculateMemberPermissions, PERMISSIONS } from 'fount/public/parts/shells/chat/src/permissions/chat.mjs'

/**
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {string[]} 拥有 VIEW_CHANNEL 的 active 成员 pubKeyHash
 */
export function listChannelViewerPubKeys(state, channelId) {
	/** @type {string[]} */
	const viewers = []
	for (const [pubKeyHash, member] of Object.entries(state.members || {})) {
		if (member?.status !== 'active') continue
		const perms = calculateMemberPermissions(
			member,
			state.roles || {},
			channelId,
			state.channelPermissions || {},
		)
		if (perms[PERMISSIONS.VIEW_CHANNEL]) viewers.push(pubKeyHash.trim().toLowerCase())
	}
	return viewers
}

/**
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @returns {number} 下一密钥代际
 */
export function nextChannelKeyGeneration(state, channelId) {
	const current = Number(state.channelKeyGeneration?.[channelId] ?? -1)
	return Number.isFinite(current) ? current + 1 : 0
}

/**
 * @param {object} state 物化群状态
 * @param {string} channelId 频道 ID
 * @param {number} [generation] 指定代际，默认 next
 * @returns {{ channelId: string, generation: number, wraps: Record<string, object> }} rotate 事件 content
 */
export function buildChannelKeyRotateContent(state, channelId, generation = null) {
	const gen = generation != null ? Number(generation) : nextChannelKeyGeneration(state, channelId)
	const keyHex = generateChannelKey()
	/** @type {Record<string, object>} */
	const wraps = {}
	for (const memberKey of listChannelViewerPubKeys(state, channelId)) {
		const edPubHex = String(state.members[memberKey]?.pubKeyHex || '').trim().toLowerCase()
		if (!PUB_KEY_HEX_64.test(edPubHex)) continue
		wraps[memberKey] = wrapChannelKey(keyHex, edPubHex)
	}
	return { channelId, generation: gen, wraps }
}

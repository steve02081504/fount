/**
 * 虚拟桥接会话 registry 兼容面（不再建真实 chat 群）。
 */
import {
	ensureVirtualBridgeSession,
	getVirtualBridgeSession,
	isVirtualBridgeBackfilled,
	listVirtualBridgeSessions,
	markVirtualBridgeBackfilled,
	parseVirtualBridgeGroupId,
	virtualBridgeChannelId,
	virtualBridgeGroupId,
} from './session.mjs'

/**
 * @param {string} username replica
 * @param {{ platform: string, platformChatId: string | number, chatKind?: 'dm' | 'group', name?: string, botname?: string, charname?: string }} args 参数
 * @returns {Promise<{ groupId: string, mapping: object }>} 虚拟群
 */
export async function ensureBridgeGroup(username, args) {
	const session = ensureVirtualBridgeSession(username, args)
	return {
		groupId: session.groupId,
		mapping: {
			groupId: session.groupId,
			channels: Object.fromEntries(
				Object.keys(session.channels).map(id => [id === 'default' ? 'default' : id, id]),
			),
			messageMap: [],
		},
	}
}

/**
 * @param {string} username replica
 * @param {{ platform: string, platformChatId: string | number, platformThreadId?: string | number }} args 参数
 * @returns {Promise<{ groupId: string, channelId: string }>} 群与频道
 */
export async function resolveBridgeChannel(username, { platform, platformChatId, platformThreadId }) {
	const groupId = virtualBridgeGroupId(platform, platformChatId)
	if (!getVirtualBridgeSession(username, groupId))
		ensureVirtualBridgeSession(username, { platform, platformChatId })
	return {
		groupId,
		channelId: virtualBridgeChannelId(platformThreadId),
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {string | null} 桥接群键 platform:chatId
 */
export function findBridgeGroupKeyByGroupId(username, groupId) {
	const parsed = parseVirtualBridgeGroupId(groupId)
	if (!parsed || !getVirtualBridgeSession(username, groupId)) return null
	return `${parsed.platform}:${parsed.platformChatId}`
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string | number} platformMessageId 平台消息 id
 * @returns {string | null} eventId
 */
export function lookupBridgeEventId(username, groupId, platformMessageId) {
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return null
	const needle = String(platformMessageId)
	for (const channel of Object.values(session.channels)) 
		for (let i = channel.messageMap.length - 1; i >= 0; i--) {
			const row = channel.messageMap[i]
			if (String(row.platformMessageId) === needle)
				return String(row.eventId).toLowerCase()
		}
	
	return null
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} eventId 虚拟事件 id
 * @returns {string | null} platformMessageId
 */
export function lookupBridgePlatformMessageId(username, groupId, eventId) {
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return null
	const needle = String(eventId || '').trim().toLowerCase()
	for (const channel of Object.values(session.channels)) 
		for (let i = channel.messageMap.length - 1; i >= 0; i--) {
			const row = channel.messageMap[i]
			if (String(row.eventId).toLowerCase() === needle)
				return String(row.platformMessageId)
		}
	
	return null
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {{ eventId: string, platformMessageId: string | number }} pair 映射对
 * @returns {Promise<void>}
 */
export async function recordBridgeMessagePair(username, groupId, { eventId, platformMessageId }) {
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return
	const channel = session.channels.default
	if (!channel) return
	channel.messageMap.push({
		eventId: String(eventId).trim().toLowerCase(),
		platformMessageId: String(platformMessageId),
	})
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否已回填
 */
export function isBridgeGroupBackfilled(username, groupId) {
	return isVirtualBridgeBackfilled(username, groupId)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function markBridgeGroupBackfilled(username, groupId) {
	markVirtualBridgeBackfilled(username, groupId)
}

/**
 * @param {string} username replica
 * @returns {Array<{ groupKey: string, groupId: string }>} 映射列表
 */
export function listBridgeGroupMappings(username) {
	return listVirtualBridgeSessions(username).map(session => ({
		groupKey: `${session.platform}:${session.platformChatId}`,
		groupId: session.groupId,
	}))
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {{ platformChatId: string, platformThreadId?: string } | null} 平台定位
 */
export function lookupBridgePlatformChannel(username, groupId, channelId) {
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return null
	const id = String(channelId || 'default').trim() || 'default'
	return {
		platformChatId: session.platformChatId,
		...id !== 'default' ? { platformThreadId: id } : {},
	}
}

/**
 * @param {string} username replica
 * @param {string} groupKey 键
 * @returns {object | null} 映射
 */
export function getBridgeGroupMapping(username, groupKey) {
	const colon = String(groupKey).indexOf(':')
	if (colon < 0) return null
	const platform = groupKey.slice(0, colon)
	const platformChatId = groupKey.slice(colon + 1)
	const groupId = virtualBridgeGroupId(platform, platformChatId)
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return null
	return { groupId: session.groupId, channels: { default: 'default' }, messageMap: [] }
}

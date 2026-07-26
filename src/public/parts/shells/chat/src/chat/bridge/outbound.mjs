import { dropVirtualBridgeSessionsForBot } from './session.mjs'

/** @type {Map<string, (args: { channelId: string, messageLine: object, replyToPlatformMessageId?: string | null, charname?: string }) => Promise<{ platformMessageId?: string | number } | void>>} */
const outboundHandlers = new Map()

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {string} 复合键
 */
function handlerKey(username, groupId) {
	return `${username}:${groupId}`
}

/**
 * 注册虚拟桥接群出站 handler（bot 壳分段/贴纸后发平台）。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {(args: { channelId: string, messageLine: object, replyToPlatformMessageId?: string | null, charname?: string }) => Promise<{ platformMessageId?: string | number } | void>} handler 出站
 * @returns {void}
 */
export function registerBridgeOutbound(username, groupId, handler) {
	outboundHandlers.set(handlerKey(username, groupId), handler)
}

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {void}
 */
export function unregisterBridgeOutbound(username, groupId) {
	outboundHandlers.delete(handlerKey(username, groupId))
}

/**
 * bot 停止时统一清理 outbound 注册、虚拟会话与 char 运行时表项。
 * @param {{ username: string, platform: string, botname: string, outboundRegistered: Set<string>, registry: Record<string, Record<string, unknown>>, charname: string }} args 清理参数
 * @returns {void}
 */
export function teardownBridgeInterface({
	username,
	platform,
	botname,
	outboundRegistered,
	registry,
	charname,
}) {
	for (const groupId of outboundRegistered)
		unregisterBridgeOutbound(username, groupId)
	outboundRegistered.clear()
	dropVirtualBridgeSessionsForBot(username, platform, botname)
	delete registry[username]?.[charname]
	if (registry[username] && !Object.keys(registry[username]).length)
		delete registry[username]
}

/**
 * char 产出消息后通知壳层出站。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 虚拟 log 行
 * @param {string} [charname] 角色名
 * @returns {Promise<void>}
 */
export async function notifyVirtualBridgeOutbound(username, groupId, channelId, messageLine, charname) {
	const handler = outboundHandlers.get(handlerKey(username, groupId))
	if (!handler) return
	const { lookupVirtualOutboundReplyTarget } = await import('./virtualObjects.mjs')
	const {
		getVirtualBridgeSession,
		lookupVirtualBridgePlatformMessageId,
		recordVirtualBridgeMessagePair,
	} = await import('./session.mjs')
	const replyEventId = messageLine?.extension?.chat?.replyTo?.eventId
		|| messageLine?.extension?.chat?.bridge?.replyToEventId
	const replyToPlatformMessageId = replyEventId
		? lookupVirtualOutboundReplyTarget(username, groupId, channelId, replyEventId)
		: null
	const eventId = messageLine?.extension?.chat?.virtualEventId ?? messageLine?.eventId
	const result = await handler({
		channelId,
		messageLine: {
			...messageLine,
			eventId,
			content: messageLine.content,
			files: messageLine.files,
			charId: charname || messageLine.extension?.charId,
		},
		replyToPlatformMessageId,
		charname,
	})
	const platformMessageId = result?.platformMessageId
	if (platformMessageId != null && eventId) {
		const session = getVirtualBridgeSession(username, groupId)
		const channel = session?.channels[channelId]
		if (channel && !lookupVirtualBridgePlatformMessageId(channel, eventId))
			recordVirtualBridgeMessagePair(channel, eventId, platformMessageId)
	}
}

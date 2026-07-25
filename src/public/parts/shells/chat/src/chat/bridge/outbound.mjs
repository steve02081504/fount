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
	const { getVirtualBridgeSession, lookupVirtualBridgePlatformMessageId } = await import('./session.mjs')
	const replyEventId = messageLine?.extension?.replyTo?.eventId
		|| messageLine?.extension?.bridge?.replyToEventId
	const replyToPlatformMessageId = replyEventId
		? lookupVirtualOutboundReplyTarget(username, groupId, channelId, replyEventId)
		: null
	const result = await handler({
		channelId,
		messageLine: {
			...messageLine,
			eventId: messageLine.extension?.virtualEventId,
			content: typeof messageLine.content === 'string'
				? { type: 'text', content: messageLine.content }
				: messageLine.content,
			files: messageLine.files,
			charId: charname || messageLine.extension?.charId,
		},
		replyToPlatformMessageId,
		charname,
	})
	const platformMessageId = result?.platformMessageId
	const eventId = messageLine?.extension?.virtualEventId
	if (platformMessageId != null && eventId) {
		const session = getVirtualBridgeSession(username, groupId)
		const channel = session?.channels[channelId]
		if (channel && !lookupVirtualBridgePlatformMessageId(channel, eventId)) 
			channel.messageMap.push({
				eventId: String(eventId).toLowerCase(),
				platformMessageId: String(platformMessageId),
			})
		
	}
}

/** @deprecated 兼容旧名 */
export const notifyBridgeOutbound = notifyVirtualBridgeOutbound

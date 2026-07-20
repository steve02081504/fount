import { lookupBridgePlatformMessageId, recordBridgeMessagePair } from './registry.mjs'

/** @type {Map<string, (args: { channelId: string, messageLine: object, replyToPlatformMessageId?: string | null }) => Promise<{ platformMessageId?: string | number } | void>>} */
const outboundHandlers = new Map()

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {string} username:groupId 复合键
 */
function handlerKey(username, groupId) {
	return `${username}:${groupId}`
}

/**
 * 注册桥接群出站 handler（char 回复落盘后调用）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {(args: { channelId: string, messageLine: object, replyToPlatformMessageId?: string | null }) => Promise<{ platformMessageId?: string | number } | void>} handler 出站处理
 * @returns {void}
 */
export function registerBridgeOutbound(username, groupId, handler) {
	outboundHandlers.set(handlerKey(username, groupId), handler)
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function unregisterBridgeOutbound(username, groupId) {
	outboundHandlers.delete(handlerKey(username, groupId))
}

/**
 * char 产出消息落盘后通知桥接壳层出站。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @returns {Promise<void>}
 */
export async function notifyBridgeOutbound(username, groupId, channelId, messageLine) {
	const handler = outboundHandlers.get(handlerKey(username, groupId))
	if (!handler) return
	const replyEventId = messageLine?.content?.replyTo?.eventId
		|| messageLine?.content?.extension?.bridge?.replyToEventId
	const replyToPlatformMessageId = replyEventId
		? lookupBridgePlatformMessageId(username, groupId, replyEventId)
		: null
	const result = await handler({ channelId, messageLine, replyToPlatformMessageId })
	const platformMessageId = result?.platformMessageId
	if (platformMessageId != null && messageLine?.eventId)
		await recordBridgeMessagePair(username, groupId, {
			eventId: messageLine.eventId,
			platformMessageId,
		})
}

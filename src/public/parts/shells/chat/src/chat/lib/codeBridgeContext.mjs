import { resolveBridgeOps } from '../bridge/ops.mjs'
import { lookupBridgePlatformChannel } from '../bridge/registry.mjs'
import { getState } from '../dag/materialize.mjs'

/**
 * 从 chat_log 取触发本次生成的最近一条非 char 消息。
 * @param {import('../../../../../../decl/chatLog.ts').chatLogEntry_t[] | undefined} chatLog 聊天日志
 * @returns {import('../../../../../../decl/chatLog.ts').chatLogEntry_t | undefined} 触发消息行
 */
export function findTriggerChatLogEntry(chatLog) {
	return [...chatLog || []].reverse().find(entry => entry.role !== 'char' && entry.extension?.dagEventId)
}

/**
 * @param {import('../../../../../../decl/chatLog.ts').chatLogEntry_t | undefined} entry 日志行
 * @returns {object | null} 桥接入站元数据
 */
export function bridgeMetaFromChatLogEntry(entry) {
	const content = entry?.content
	if (content && typeof content === 'object' && content.extension?.bridge)
		return content.extension.bridge
	return null
}

/**
 * 解析当前 fount 频道对应的平台会话 id。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ platform: string, platformChatId: string, platformThreadId?: string } | null>} 非桥接群为 null
 */
export async function resolveBridgePlatformIds(username, groupId, channelId) {
	const { state } = await getState(username, groupId)
	const bridge = state.groupSettings?.bridge
	if (!bridge?.platform || bridge.platformChatId == null) return null

	const mapped = lookupBridgePlatformChannel(username, groupId, channelId)
	return {
		platform: String(bridge.platform),
		platformChatId: mapped?.platformChatId ?? String(bridge.platformChatId),
		...mapped?.platformThreadId ? { platformThreadId: mapped.platformThreadId } : {},
	}
}

/**
 * 桥接群场景下调用壳层注册的 getNativeContext 水合平台原生对象。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {import('../../../../../../decl/chatLog.ts').chatLogEntry_t | undefined} triggerEntry 触发消息
 * @returns {Promise<(object & { platform: string }) | null>} 水合后的平台原生上下文
 */
export async function hydrateBridgeNativeContext(username, groupId, channelId, triggerEntry) {
	const ids = await resolveBridgePlatformIds(username, groupId, channelId)
	if (!ids) return null

	const platformMessageId = bridgeMetaFromChatLogEntry(triggerEntry)?.platformMessageId
	const getNativeContext = resolveBridgeOps(ids.platform)?.getNativeContext
	if (!getNativeContext)
		return { ...ids, platformMessageId }

	const targetChannelId = ids.platformThreadId || ids.platformChatId
	return {
		...ids,
		platformMessageId,
		...await getNativeContext({
			platformChatId: targetChannelId,
			platformMessageId,
			platformThreadId: ids.platformThreadId,
		}),
	}
}

import { resolveBridgeOperations } from '../bridge/operations.mjs'
import { lookupBridgePlatformChannel } from '../bridge/registry.mjs'
import { isVirtualBridgeGroupId } from '../bridge/session.mjs'
import { hydrateVirtualBridgeNativeContext } from '../bridge/virtualObjects.mjs'
import { getState } from '../dag/materialize.mjs'

/**
 * 从 chat_log 取触发本次生成的最近一条非 char 消息。
 * @param {import('../../../../../../decl/chatLog.ts').chatLogEntry_t[] | undefined} chatLog 聊天日志
 * @returns {import('../../../../../../decl/chatLog.ts').chatLogEntry_t | undefined} 触发消息行
 */
export function findTriggerChatLogEntry(chatLog) {
	return [...chatLog || []].reverse().find(entry =>
		entry.role !== 'char'
		&& (entry.extension?.virtualEventId || entry.extension?.dagEventId || entry.extension?.bridge))
}

/**
 * @param {import('../../../../../../decl/chatLog.ts').chatLogEntry_t | undefined} entry 日志行
 * @returns {object | null} 桥接入站元数据
 */
export function bridgeMetaFromChatLogEntry(entry) {
	return entry?.extension?.bridge
		?? entry?.content?.extension?.bridge
		?? null
}

/**
 * 解析当前频道对应的平台会话 id。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<{ platform: string, platformChatId: string, platformThreadId?: string, botname?: string } | null>} 非桥接为 null
 */
export async function resolveBridgePlatformIds(username, groupId, channelId) {
	if (isVirtualBridgeGroupId(groupId)) {
		const { getVirtualBridgeSession } = await import('../bridge/session.mjs')
		const session = getVirtualBridgeSession(username, groupId)
		if (!session) return null
		const id = String(channelId || 'default').trim() || 'default'
		return {
			platform: session.platform,
			platformChatId: session.platformChatId,
			...session.botname ? { botname: session.botname } : {},
			...id !== 'default' ? { platformThreadId: id } : {},
		}
	}

	const { state } = await getState(username, groupId)
	const bridge = state.groupSettings?.bridge
	if (!bridge?.platform || bridge.platformChatId == null) return null

	const mapped = lookupBridgePlatformChannel(username, groupId, channelId)
	return {
		platform: String(bridge.platform),
		platformChatId: mapped?.platformChatId ?? String(bridge.platformChatId),
		...bridge.botname ? { botname: String(bridge.botname) } : {},
		...mapped?.platformThreadId ? { platformThreadId: mapped.platformThreadId } : {},
	}
}

/**
 * 桥接场景下调用壳层 getNativeContext 水合平台原生对象。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {import('../../../../../../decl/chatLog.ts').chatLogEntry_t | undefined} triggerEntry 触发消息
 * @returns {Promise<(object & { platform: string }) | null>} 水合后的平台原生上下文
 */
export async function hydrateBridgeNativeContext(username, groupId, channelId, triggerEntry) {
	if (isVirtualBridgeGroupId(groupId))
		return hydrateVirtualBridgeNativeContext(username, groupId, channelId, triggerEntry)

	const ids = await resolveBridgePlatformIds(username, groupId, channelId)
	if (!ids) return null

	const platformMessageId = bridgeMetaFromChatLogEntry(triggerEntry)?.platformMessageId
	const getNativeContext = ids.botname
		? resolveBridgeOperations(username, { platform: ids.platform, botname: ids.botname })?.getNativeContext
		: undefined
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

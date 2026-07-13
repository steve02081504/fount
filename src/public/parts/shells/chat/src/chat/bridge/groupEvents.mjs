import { buildConversationContext } from '../lib/conversationContext.mjs'
import { dispatchCharError } from '../session/charError.mjs'
import { getCharListOfGroup } from '../session/partConfig.mjs'
import { resolveChar } from '../session/resolvePart.mjs'

import { resolveBridgeIdentity } from './identity.mjs'
import { ensureBridgeGroup, resolveBridgeChannel } from './registry.mjs'


/**
 * 构建 onGroupEvent 事件体。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} type 事件类型
 * @param {object} [member] 成员事实
 * @returns {Promise<object>} 可序列化事件
 */
async function buildGroupEvent(username, groupId, channelId, type, member) {
	const { group, channel } = await buildConversationContext(username, groupId, channelId)
	return {
		type,
		group,
		channel,
		...member ? { member } : {},
	}
}

/**
 * 向群内 char 分发群生命周期事件。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} event onGroupEvent 事件
 * @returns {Promise<void>}
 */
async function dispatchGroupEventToChars(username, groupId, channelId, event) {
	const chars = await getCharListOfGroup(groupId, username)
	for (const charname of chars) {
		const char = await resolveChar(groupId, charname, username)
		if (!char?.interfaces?.chat?.onGroupEvent) continue
		try {
			await char.interfaces.chat.onGroupEvent(event)
		}
		catch (error) {
			await dispatchCharError(char, error, {
				username,
				source: 'onGroupEvent',
				groupId,
				channelId,
				charname,
				event,
			})
		}
	}
}

/**
 * 桥接平台群生命周期事件 → char onGroupEvent。
 * @param {string} username replica
 * @param {{ type: string, platform: string, platformChatId: string | number, platformThreadId?: string | number, chatKind?: string, chatName?: string, botname?: string, member?: { platformUserId: string | number, displayName?: string } }} dto DTO
 * @returns {Promise<void>}
 */
export async function postBridgeGroupEvent(username, dto) {
	const platform = String(dto.platform || '').trim()
	const platformChatId = dto.platformChatId
	if (!platform || platformChatId == null) throw new Error('platform and platformChatId required')

	const chatKind = dto.chatKind === 'dm' ? 'dm' : 'group'
	await ensureBridgeGroup(username, {
		platform,
		platformChatId,
		chatKind,
		name: dto.chatName,
		botname: dto.botname,
	})
	const { groupId, channelId } = await resolveBridgeChannel(username, {
		platform,
		platformChatId,
		platformThreadId: dto.platformThreadId,
	})

	let member
	if (dto.member?.platformUserId != null) {
		const entityHash = await resolveBridgeIdentity(
			username,
			platform,
			dto.member.platformUserId,
			dto.member.displayName,
		)
		member = {
			entityHash,
			platformUserId: String(dto.member.platformUserId),
			displayName: String(dto.member.displayName || '').trim() || undefined,
		}
	}

	const event = await buildGroupEvent(username, groupId, channelId, dto.type, member)
	await dispatchGroupEventToChars(username, groupId, channelId, event)
}

/**
 * bot 启动后对已映射桥接群广播 bot_started。
 * @param {string} username replica
 * @param {string} platform 平台
 * @param {string} botname bot 实例名
 * @returns {Promise<void>}
 */
export async function dispatchBridgeBotStarted(username, platform, botname) {
	const { listBridgeGroupMappings } = await import('./registry.mjs')
	const { getState } = await import('../dag/materialize.mjs')
	for (const { groupId } of listBridgeGroupMappings(username)) {
		const { state } = await getState(username, groupId)
		const bridge = state.groupSettings?.bridge
		if (!bridge || bridge.platform !== platform || String(bridge.botname || '') !== String(botname)) continue
		const event = await buildGroupEvent(username, groupId, 'default', 'bot_started')
		await dispatchGroupEventToChars(username, groupId, 'default', event)
	}
}

import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { dispatchCharError } from '../session/charError.mjs'

import { resolveBridgeIdentity } from './identity.mjs'
import {
	ensureVirtualBridgeSession,
	listVirtualBridgeSessions,
	virtualBridgeChannelId,
} from './session.mjs'

/**
 * @param {object} session 虚拟会话
 * @param {string} channelId 频道 ID
 * @param {string} type 事件类型
 * @param {object} [member] 成员事实
 * @returns {object} OnGroupEvent
 */
function buildVirtualGroupEvent(session, channelId, type, member) {
	return {
		type,
		group: {
			groupId: session.groupId,
			name: session.name,
			kind: session.chatKind === 'dm' ? 'dm' : 'group',
			bridge: {
				platform: session.platform,
				platformChatId: session.platformChatId,
				chatKind: session.chatKind,
				...session.botname ? { botname: session.botname } : {},
			},
			memberCount: 0,
		},
		channel: {
			channelId,
			name: session.channels[channelId]?.name || channelId,
			kind: channelId === 'default' ? 'text' : 'thread',
		},
		...member ? { member } : {},
	}
}

/**
 * @param {string} username replica
 * @param {object} session 虚拟会话
 * @param {object} event 事件
 * @returns {Promise<void>}
 */
async function dispatchToSessionChar(username, session, event) {
	if (!session.charname) return
	const char = await loadPart(username, `chars/${session.charname}`)
	if (!char?.interfaces?.chat?.OnGroupEvent) return
	try {
		await char.interfaces.chat.OnGroupEvent(event)
	}
	catch (error) {
		await dispatchCharError(char, error, {
			username,
			source: 'OnGroupEvent',
			groupId: session.groupId,
			channelId: event.channel?.channelId,
			charname: session.charname,
			event,
		})
	}
}

/**
 * 桥接平台群生命周期事件 → char OnGroupEvent（虚拟会话）。
 * @param {string} username replica
 * @param {{ type: string, platform: string, platformChatId: string | number, platformThreadId?: string | number, chatKind?: string, chatName?: string, botname?: string, member?: { platformUserId: string | number, displayName?: string } }} dto DTO
 * @returns {Promise<void>}
 */
export async function postBridgeGroupEvent(username, dto) {
	const platform = (dto.platform || '')
	const platformChatId = dto.platformChatId
	if (!platform || platformChatId == null) throw new Error('platform and platformChatId required')

	const session = ensureVirtualBridgeSession(username, {
		platform,
		platformChatId,
		chatKind: dto.chatKind === 'dm' ? 'dm' : 'group',
		name: dto.chatName,
		botname: dto.botname,
	})
	const channelId = virtualBridgeChannelId(dto.platformThreadId)

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
			displayName: (dto.member.displayName || '') || undefined,
		}
	}

	const event = buildVirtualGroupEvent(session, channelId, dto.type, member)
	await dispatchToSessionChar(username, session, event)
}

/**
 * bot 启动后对已映射虚拟会话广播 bot_started。
 * @param {string} username replica
 * @param {string} platform 平台
 * @param {string} botname bot 实例名
 * @returns {Promise<void>}
 */
export async function dispatchBridgeBotStarted(username, platform, botname) {
	for (const session of listVirtualBridgeSessions(username, platform, botname)) {
		const event = buildVirtualGroupEvent(session, 'default', 'bot_started')
		await dispatchToSessionChar(username, session, event)
	}
}

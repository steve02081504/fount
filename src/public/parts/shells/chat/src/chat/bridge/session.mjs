/**
 * 平台 bot 虚拟会话：进程内 chat log，不落真实 chat 群 / DAG。
 */
import { resolveBridgeIdentity } from './identity.mjs'

const LOG_MAX = 200
const MESSAGE_MAP_MAX = 500

/** @type {Map<string, object>} `${username}\0${groupId}` → session */
const sessions = new Map()

/**
 * @param {string} platform 平台
 * @param {string | number} platformChatId 平台会话 ID
 * @returns {string} 虚拟群 ID
 */
export function virtualBridgeGroupId(platform, platformChatId) {
	return `bridge:${String(platform)}:${String(platformChatId)}`
}

/**
 * @param {string} groupId 群 ID
 * @returns {boolean} 是否虚拟桥接群
 */
export function isVirtualBridgeGroupId(groupId) {
	return String(groupId || '').startsWith('bridge:')
}

/**
 * @param {string} groupId 虚拟群 ID
 * @returns {{ platform: string, platformChatId: string } | null} 解析结果
 */
export function parseVirtualBridgeGroupId(groupId) {
	const raw = String(groupId || '')
	if (!raw.startsWith('bridge:')) return null
	const rest = raw.slice('bridge:'.length)
	const colon = rest.indexOf(':')
	if (colon < 0) return null
	return {
		platform: rest.slice(0, colon),
		platformChatId: rest.slice(colon + 1),
	}
}

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {string} store 键
 */
function sessionKey(username, groupId) {
	return `${username}\0${groupId}`
}

/**
 * @param {string | number | null | undefined} platformThreadId 平台子频道
 * @returns {string} 虚拟频道 ID
 */
export function virtualBridgeChannelId(platformThreadId) {
	const thread = platformThreadId != null && String(platformThreadId).trim()
	return thread || 'default'
}

/**
 * 确保虚拟会话存在。
 * @param {string} username replica
 * @param {{ platform: string, platformChatId: string | number, chatKind?: 'dm' | 'group', name?: string, botname?: string, charname?: string }} args 参数
 * @returns {object} session
 */
export function ensureVirtualBridgeSession(username, {
	platform,
	platformChatId,
	chatKind = 'group',
	name,
	botname,
	charname,
}) {
	const groupId = virtualBridgeGroupId(platform, platformChatId)
	const key = sessionKey(username, groupId)
	let session = sessions.get(key)
	if (!session) {
		session = {
			username,
			groupId,
			platform: String(platform),
			platformChatId: String(platformChatId),
			chatKind: chatKind === 'dm' ? 'dm' : 'group',
			name: name || `${platform}:${platformChatId}`,
			botname: botname ? String(botname) : undefined,
			charname: charname ? String(charname) : undefined,
			channels: {
				default: { channelId: 'default', name: 'default', logs: [], messageMap: [] },
			},
			/** @type {Record<string, object>} charname → 进程内记忆 */
			charMemories: {},
			backfilled: false,
		}
		sessions.set(key, session)
	}
	else {
		if (botname) session.botname = String(botname)
		if (charname) session.charname = String(charname)
		if (name) session.name = name
		if (chatKind === 'dm') session.chatKind = 'dm'
	}
	return session
}

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {object | null} session
 */
export function getVirtualBridgeSession(username, groupId) {
	return sessions.get(sessionKey(username, groupId)) || null
}

/**
 * 虚拟桥接群的平台定位（chat / 可选 thread）。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @returns {{ platform: string, platformChatId: string, botname?: string, platformThreadId?: string } | null} 定位
 */
export function resolveVirtualBridgePlatformIds(username, groupId, channelId) {
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

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @returns {object} channel 桶
 */
export function ensureVirtualBridgeChannel(username, groupId, channelId) {
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) throw new Error(`virtual bridge session not found: ${groupId}`)
	const id = String(channelId || 'default').trim() || 'default'
	if (!session.channels[id]) 
		session.channels[id] = {
			channelId: id,
			name: id === 'default' ? 'default' : `thread:${id}`,
			logs: [],
			messageMap: [],
		}
	
	return session.channels[id]
}

/**
 * @param {object} channel 频道桶
 * @param {object} entry chatLogEntry
 * @returns {void}
 */
function pushLog(channel, entry) {
	channel.logs.push(entry)
	if (channel.logs.length > LOG_MAX)
		channel.logs = channel.logs.slice(-LOG_MAX)
}

/**
 * @param {object} channel 频道桶
 * @param {string} eventId 虚拟事件 id
 * @param {string | number} platformMessageId 平台消息 id
 * @returns {void}
 */
/**
 * @param {object} channel 频道桶
 * @param {string} eventId 虚拟事件 id
 * @param {string | number} platformMessageId 平台消息 id
 * @returns {void}
 */
export function recordVirtualBridgeMessagePair(channel, eventId, platformMessageId) {
	channel.messageMap.push({
		eventId: String(eventId).toLowerCase(),
		platformMessageId: String(platformMessageId),
	})
	if (channel.messageMap.length > MESSAGE_MAP_MAX)
		channel.messageMap = channel.messageMap.slice(-MESSAGE_MAP_MAX)
}

/**
 * DTO → 虚拟 log 行。
 * @param {string} username replica
 * @param {object} dto 桥接 DTO
 * @returns {Promise<{ session: object, channel: object, entry: object }>} 写入结果
 */
export async function appendVirtualBridgeMessage(username, dto) {
	const session = ensureVirtualBridgeSession(username, {
		platform: dto.platform,
		platformChatId: dto.platformChatId,
		chatKind: dto.chatKind,
		name: dto.chatName,
		botname: dto.botname,
	})
	const channelId = virtualBridgeChannelId(dto.platformThreadId)
	const channel = ensureVirtualBridgeChannel(username, session.groupId, channelId)
	const authorEntityHash = await resolveBridgeIdentity(
		username,
		dto.platform,
		dto.author.platformUserId,
		dto.author.displayName,
	)
	let authorDisplayName = String(dto.author.displayName || '').trim() || `User_${dto.author.platformUserId}`
	let displayAvatar = dto.author.avatarUrl
	const { isBoundBridgeIdentity } = await import('./identity.mjs')
	if (isBoundBridgeIdentity(username, dto.platform, dto.author.platformUserId)) 
		try {
			const { getProfile } = await import('../../entity/profile.mjs')
			const profile = await getProfile(authorEntityHash, username)
			if (profile?.name) authorDisplayName = String(profile.name).trim() || authorDisplayName
			if (profile?.avatar) displayAvatar = profile.avatar
		}
		catch { /* profile optional */ }
	
	const eventId = `vmsg_${dto.platform}_${dto.platformMessageId}_${Date.now().toString(36)}`
	const text = String(dto.text || '')
	/** @type {{ eventId: string, senderName?: string, preview?: string, senderEntityHash?: string } | undefined} */
	let replyTo
	if (dto.replyToPlatformMessageId != null) {
		const parentEventId = lookupVirtualBridgeEventId(channel, dto.replyToPlatformMessageId)
		if (parentEventId) {
			const parent = channel.logs.find(row => String(row.extension?.virtualEventId || '').toLowerCase() === parentEventId)
			replyTo = {
				eventId: parentEventId,
				...parent?.name ? { senderName: parent.name } : {},
				...parent?.uid ? { senderEntityHash: parent.uid } : {},
				...parent?.content
					? { preview: String(parent.content).replace(/\s+/g, ' ').trim().slice(0, 120) }
					: {},
			}
		}
	}
	const entry = {
		name: authorDisplayName,
		uid: authorEntityHash,
		role: 'user',
		content: text,
		content_for_show: text,
		time_stamp: dto.timestamp ? new Date(Number(dto.timestamp)) : new Date(),
		files: (dto.files || []).map(file => ({
			name: file.name,
			mime_type: file.mime_type,
			buffer: file.buffer,
			description: file.description || '',
		})),
		extension: {
			virtualEventId: eventId,
			groupChannelId: channelId,
			bridge: {
				platform: String(dto.platform),
				platformChatId: String(dto.platformChatId),
				platformMessageId: String(dto.platformMessageId),
				platformUserId: String(dto.author.platformUserId),
				authorEntityHash,
				authorDisplayName: String(dto.author.displayName || '').trim(),
				...dto.platformThreadId != null ? { platformThreadId: String(dto.platformThreadId) } : {},
				...dto.replyToPlatformMessageId != null
					? { replyToPlatformMessageId: String(dto.replyToPlatformMessageId) }
					: {},
				...replyTo?.eventId ? { replyToEventId: replyTo.eventId } : {},
			},
			...replyTo ? { replyTo } : {},
			...displayAvatar ? { displayAvatar } : {},
		},
	}
	if (dto.ingress === 'backfill') entry.extension.ingress = 'backfill'
	pushLog(channel, entry)
	recordVirtualBridgeMessagePair(channel, eventId, dto.platformMessageId)
	return { session, channel, entry }
}

/**
 * @param {object} channel 频道桶
 * @param {string | number} platformMessageId 平台消息 id
 * @returns {string | null} eventId
 */
export function lookupVirtualBridgeEventId(channel, platformMessageId) {
	const needle = String(platformMessageId)
	for (let i = channel.messageMap.length - 1; i >= 0; i--) {
		const row = channel.messageMap[i]
		if (String(row.platformMessageId) === needle)
			return String(row.eventId).toLowerCase()
	}
	return null
}

/**
 * @param {object} channel 频道桶
 * @param {string} eventId 虚拟事件 id
 * @returns {string | null} platformMessageId
 */
export function lookupVirtualBridgePlatformMessageId(channel, eventId) {
	const needle = String(eventId || '').trim().toLowerCase()
	if (!needle) return null
	for (let i = channel.messageMap.length - 1; i >= 0; i--) {
		const row = channel.messageMap[i]
		if (String(row.eventId).toLowerCase() === needle)
			return String(row.platformMessageId)
	}
	return null
}

/**
 * @param {string} username replica
 * @param {object} dto 编辑 DTO
 * @returns {Promise<{ session: object, channel: object, entry: object } | null>} 结果
 */
export async function editVirtualBridgeMessage(username, dto) {
	const groupId = virtualBridgeGroupId(dto.platform, dto.platformChatId)
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return null
	const channel = ensureVirtualBridgeChannel(username, groupId, virtualBridgeChannelId(dto.platformThreadId))
	const eventId = lookupVirtualBridgeEventId(channel, dto.platformMessageId)
	if (!eventId) return null
	const entry = channel.logs.find(row => String(row.extension?.virtualEventId || '').toLowerCase() === eventId)
	if (!entry) return null
	const text = String(dto.text || '')
	entry.content = text
	entry.content_for_show = text
	if (dto.files) 
		entry.files = dto.files.map(file => ({
			name: file.name,
			mime_type: file.mime_type,
			buffer: file.buffer,
			description: file.description || '',
		}))
	
	return { session, channel, entry }
}

/**
 * @param {string} username replica
 * @param {object} dto 删除 DTO
 * @returns {Promise<boolean>} 是否删除
 */
export async function deleteVirtualBridgeMessage(username, dto) {
	const groupId = virtualBridgeGroupId(dto.platform, dto.platformChatId)
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) return false
	const channel = ensureVirtualBridgeChannel(username, groupId, virtualBridgeChannelId(dto.platformThreadId))
	const eventId = lookupVirtualBridgeEventId(channel, dto.platformMessageId)
	if (!eventId) return false
	const index = channel.logs.findIndex(row => String(row.extension?.virtualEventId || '').toLowerCase() === eventId)
	if (index < 0) return false
	channel.logs.splice(index, 1)
	channel.messageMap = channel.messageMap.filter(row => String(row.eventId).toLowerCase() !== eventId)
	return true
}

/**
 * 追加角色回复到虚拟 log。
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {object} reply chatReply
 * @param {string} charname 角色名
 * @param {string} [charUid] 角色 entityHash
 * @returns {{ entry: object, channel: object }} 写入结果
 */
export function appendVirtualBridgeCharReply(username, groupId, channelId, reply, charname, charUid) {
	const channel = ensureVirtualBridgeChannel(username, groupId, channelId)
	const text = String(reply?.content ?? '')
	const eventId = `vchar_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
	const entry = {
		name: reply?.name || charname,
		uid: charUid || 'char',
		role: 'char',
		content: text,
		content_for_show: reply?.content_for_show ?? text,
		time_stamp: new Date(),
		files: (reply?.files || []).map(file => ({
			name: file.name,
			mime_type: file.mime_type,
			buffer: file.buffer,
			description: file.description || '',
		})),
		extension: {
			virtualEventId: eventId,
			groupChannelId: channelId,
			charId: charname,
			...reply?.extension,
		},
	}
	pushLog(channel, entry)
	return { entry, channel }
}

/**
 * @param {string} username replica
 * @param {string} [platform] 可选平台过滤
 * @param {string} [botname] 可选 bot 过滤
 * @returns {object[]} sessions
 */
export function listVirtualBridgeSessions(username, platform, botname) {
	const prefix = `${username}\0`
	/** @type {object[]} */
	const rows = []
	for (const [key, session] of sessions.entries()) {
		if (!key.startsWith(prefix)) continue
		if (platform && session.platform !== platform) continue
		if (botname != null && String(session.botname || '') !== String(botname)) continue
		rows.push(session)
	}
	return rows
}

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {void}
 */
export function dropVirtualBridgeSession(username, groupId) {
	sessions.delete(sessionKey(username, groupId))
}

/**
 * 清理某 bot 的全部虚拟会话。
 * @param {string} username replica
 * @param {string} platform 平台
 * @param {string} botname bot 实例名
 * @returns {void}
 */
export function dropVirtualBridgeSessionsForBot(username, platform, botname) {
	for (const session of listVirtualBridgeSessions(username, platform, botname))
		dropVirtualBridgeSession(username, session.groupId)
}

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {boolean} 是否已回填
 */
export function isVirtualBridgeBackfilled(username, groupId) {
	return !!getVirtualBridgeSession(username, groupId)?.backfilled
}

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @returns {void}
 */
export function markVirtualBridgeBackfilled(username, groupId) {
	const session = getVirtualBridgeSession(username, groupId)
	if (session) session.backfilled = true
}

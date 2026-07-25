/**
 * 从虚拟会话组装 chatReplyRequest（Uid 语义与 getChatRequest 一致）。
 */
import { getLocalizedInfo, localesForUser } from '../../../../../../../scripts/locale.mjs'
import { resolveDeclaredOwnerEntityHash } from '../../entity/master.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'
import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../session/builtinParts.mjs'

import { getVirtualBridgeSession } from './session.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 虚拟群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @param {object} [triggerEntry] 触发消息行
 * @returns {Promise<object>} chatReplyRequest_t
 */
export async function buildVirtualBridgeChatRequest(username, groupId, channelId, charname, charAPI, triggerEntry) {
	const session = getVirtualBridgeSession(username, groupId)
	if (!session) throw new Error(`virtual bridge session not found: ${groupId}`)
	const channel = session.channels[channelId] || session.channels.default
	const chat_log = [...channel?.logs || []]
	const locales = localesForUser(username)
	const charInfo = getLocalizedInfo(charAPI.info, locales) || {}
	const operatorUid = (await resolveOperatorEntityHash(username))?.toLowerCase() || 'user'
	const charUid = (await ensureLocalAgentEntityHash(username, charname)).toLowerCase()
	const declaredOwnerEntityHash = (await resolveDeclaredOwnerEntityHash(username, charUid))?.toLowerCase()
		|| operatorUid

	let operatorName = username
	try {
		const { loadAnyPreferredDefaultPart } = await import('../../../../../../../server/parts_loader.mjs')
		const persona = await loadAnyPreferredDefaultPart(username, 'personas')
		const personaInfo = getLocalizedInfo(persona?.info, locales)
		if (personaInfo?.name) operatorName = personaInfo.name
	}
	catch { /* builtin */ }

	const lastUser = [...chat_log].reverse().find(row => row.role !== 'char') || triggerEntry
	const ReplyToUid = lastUser?.uid || undefined
	const ReplyToCharname = lastUser?.name || undefined
	const memory = session.charMemories[charname] ??= {}

	const request = {
		supported_functions: {
			markdown: true,
			mathjax: true,
			html: true,
			unsafe_html: false,
			files: true,
			add_message: true,
			fount_i18nkeys: true,
			fount_assets: true,
			fount_themes: true,
		},
		chat_name: session.name || groupId,
		char_id: charname,
		username,
		Charname: charInfo.name || charname,
		CharUid: charUid,
		UserCharname: operatorName,
		UserUid: operatorUid,
		...ReplyToCharname != null ? { ReplyToCharname } : {},
		...ReplyToUid != null ? { ReplyToUid } : {},
		locales,
		time: new Date(),
		world: BUILTIN_WORLD,
		user: BUILTIN_PERSONA,
		char: charAPI,
		other_chars: {},
		plugins: {},
		chat_log,
		timelines: [chat_log],
		chat_summary: '',
		chat_scoped_char_memory: memory,
		extension: {
			groupId,
			channelId,
			bridge: {
				platform: session.platform,
				platformChatId: session.platformChatId,
				chatKind: session.chatKind,
				...session.botname ? { botname: session.botname } : {},
				...triggerEntry?.extension?.bridge || {},
			},
			...declaredOwnerEntityHash ? { declaredOwnerEntityHash } : {},
		},
		/**
		 * @param {object} entry 角色追加消息
		 * @returns {Promise<object>} 写入后的日志条目
		 */
		AddChatLogEntry: async entry => {
			const { appendVirtualBridgeCharReply } = await import('./session.mjs')
			const { notifyVirtualBridgeOutbound } = await import('./outbound.mjs')
			const { entry: written } = appendVirtualBridgeCharReply(
				username, groupId, channelId, entry, charname, charUid,
			)
			await notifyVirtualBridgeOutbound(username, groupId, channelId, written, charname)
			return written
		},
		/**
		 * @returns {Promise<object>} 刷新后的请求
		 */
		Update: async function update() {
			return buildVirtualBridgeChatRequest(username, groupId, channelId, charname, charAPI, triggerEntry)
		},
	}

	const { injectFountChatCodeContextPlugin } = await import('../lib/codeContextPlugin.mjs')
	request.plugins = injectFountChatCodeContextPlugin({})
	return request
}

/**
 * 构建虚拟会话 OnMessage 事件。
 * @param {string} username replica
 * @param {object} session 虚拟会话
 * @param {string} channelId 频道 ID
 * @param {object} entry 触发消息
 * @param {string} charname 角色名
 * @param {import('../../../../../../../decl/charAPI.ts').CharAPI_t} charAPI 角色 API
 * @returns {Promise<object>} OnMessage 事件
 */
export async function buildVirtualBridgeOnMessageEvent(username, session, channelId, entry, charname, charAPI) {
	const chatReplyRequest = await buildVirtualBridgeChatRequest(
		username, session.groupId, channelId, charname, charAPI, entry,
	)
	const mentions = extractMentionsFromText(String(entry.content || ''))
	return {
		message: {
			...entry,
			eventId: entry.extension?.virtualEventId,
			channelId,
			content: entry.content,
			extension: entry.extension,
		},
		mentions,
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
		chatReplyRequest,
	}
}

/**
 * @param {string} text 正文
 * @returns {{ entityHashes: string[], roleIds: string[], everyone: boolean }} mentions
 */
function extractMentionsFromText(text) {
	/** @type {string[]} */
	const entityHashes = []
	const re = /@\[entity:([0-9a-f]{128})\]/gi
	let match
	while (match = re.exec(text))
		entityHashes.push(match[1].toLowerCase())
	return { entityHashes, roleIds: [], everyone: false }
}

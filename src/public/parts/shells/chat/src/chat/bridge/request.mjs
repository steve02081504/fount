/**
 * 从虚拟会话组装 chatReplyRequest（Uid 语义与 getChatRequest 一致）。
 */
import { pickLocalizedSlice, localesForUser } from '../../../../../../../scripts/locale.mjs'
import { resolveDeclaredOwnerEntityHash } from '../../entity/master.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'
import { BUILTIN_PERSONA, BUILTIN_WORLD } from '../session/builtinParts.mjs'

import { getVirtualBridgeSession } from './session.mjs'
import { bridgeWakeKey, bridgeWakes } from './wake.mjs'

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
	// charVisibility 白名单条目仅对列出的角色可见，未列出本角色时不进本请求 prompt
	const chat_log = [...channel?.logs || []].filter(entry =>
		!(Array.isArray(entry.charVisibility) && entry.charVisibility.length
			&& !entry.charVisibility.includes(charname)))
	const locales = localesForUser(username)
	const charInfo = pickLocalizedSlice(charAPI.info, locales) || {}
	const operatorUid = await resolveOperatorEntityHash(username) || 'user'
	const charUid = await ensureLocalAgentEntityHash(username, charname)
	const declaredOwnerEntityHash = await resolveDeclaredOwnerEntityHash(username, charUid)
		|| operatorUid

	let operatorName = username
	try {
		const { loadAnyPreferredDefaultPart } = await import('../../../../../../../server/parts_loader.mjs')
		const persona = await loadAnyPreferredDefaultPart(username, 'personas')
		const personaInfo = pickLocalizedSlice(persona?.info, locales)
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
		chat_id: `bridge_${groupId}::${channelId}`,
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
		// 虚拟会话无独立 workdir 存储：沿用 memory.workdir（ReplyHandler 写入处），并保证是可就地 mutate 的对象。
		workdir: memory.workdir ?? {},
		extension: {
			groupId,
			channelId,
			chat: {
				bridge: {
					platform: session.platform,
					platformChatId: session.platformChatId,
					chatKind: session.chatKind,
					...session.botname ? { botname: session.botname } : {},
					...triggerEntry?.extension?.chat?.bridge,
				},
			},
			...declaredOwnerEntityHash ? { declaredOwnerEntityHash } : {},
		},
		/**
		 * @param {object} entry 角色追加消息
		 * @returns {Promise<object>} 写入后的日志条目
		 */
		AppendChatLogEntry: async entry => {
			if (!entry?.role || entry.role === 'char') {
				const { appendVirtualBridgeCharReply } = await import('./session.mjs')
				const { notifyVirtualBridgeOutbound } = await import('./outbound.mjs')
				const { entry: written } = appendVirtualBridgeCharReply(
					username, groupId, channelId, entry, charname, charUid,
				)
				await notifyVirtualBridgeOutbound(username, groupId, channelId, written, charname)
				return written
			}
			// 非角色条目为纯写入：不进平台出站，也不触发回复
			const { appendVirtualBridgeLogEntry } = await import('./session.mjs')
			return appendVirtualBridgeLogEntry(username, groupId, channelId, entry)
		},
		/**
		 * 纯唤醒：请求本角色在本会话至少再看一次权威日志。
		 * @returns {Promise<void>}
		 */
		RequestCharReply: async () => {
			const { requestVirtualBridgeReply } = await import('./trigger.mjs')
			await requestVirtualBridgeReply(username, groupId, channelId, charname, charAPI, triggerEntry)
		},
		/**
		 * @param {{ forRound?: boolean }} [updateOptions] 刷新选项
		 * @returns {Promise<object>} 刷新后的请求
		 */
		Update: async function update(updateOptions) {
			const { forRound = false } = updateOptions ?? {}
			const snapshot = forRound ? bridgeWakes.snapshot() : 0
			const updated = await buildVirtualBridgeChatRequest(
				username, groupId, channelId, charname, charAPI, triggerEntry,
			)
			if (forRound)
				bridgeWakes.observe(bridgeWakeKey(username, groupId, channelId, charname), snapshot)
			return updated
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
	const mentions = extractMentionsFromText(entry.content || '')
	return {
		message: {
			...entry,
			eventId: entry.extension?.chat?.virtualEventId,
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
	const re = /@\[entity:([\da-f]{128})]/gi
	let match
	while (match = re.exec(text))
		entityHashes.push(match[1])
	return { entityHashes, roleIds: [], everyone: false }
}

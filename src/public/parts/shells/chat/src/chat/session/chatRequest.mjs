/**
 * 【文件】chatRequest.mjs — 角色 GetReply 用的 chatReplyRequest 构建
 * 【职责】getChatRequest 组装 decl/chatLog 定义的 prompt 结构：合并内存 prelude、DAG 频道消息水合的 chat_log、解析的世界/角色/人格/插件。
 * 【原理】先读 500 行频道消息并聚合活跃度；other_chars 取常驻∪活跃 Top-N；other_personas 取窗口内活跃人类对应的 session.personas（不含本机 user 槽）。
 * 【数据结构】chatReplyRequest_t（chat_log、timelines、other_chars、other_personas、extension.channelActivity 等）。
 * 【关联】runtime、resolvePart、channelActivity、hydration、triggerReply、viewerLog。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { localhostLocales } from '../../../../../../../scripts/i18n/bare.mjs'
import { getPartInfo } from '../../../../../../../scripts/locale.mjs'
import { getUserByUsername } from '../../../../../../../server/auth/index.mjs'
import { resolveDeclaredOwnerEntityHash } from '../../entity/master.mjs'
import { ensureLocalAgentEntityHash } from '../../entity/member.mjs'
import { resolveActiveMemberKeyForLocalUser } from '../../group/access.mjs'
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import {
	buildChatLogEntriesFromChannelLines,
	loadDagHydrationI18n,
} from '../dag/hydration.mjs'
import { getState } from '../dag/materialize.mjs'
import { resolveChannelId, resolveGroupChannelId } from '../lib/channelId.mjs'
import { injectFountChatCodeContextPlugin } from '../lib/codeContextPlugin.mjs'
import { hydrateLogContextFromSidecar, sidecarChannelForEntry } from '../lib/contextSidecar.mjs'
import { getOperatorEntityHash } from '../lib/replica.mjs'

import {
	aggregateChannelActivity,
	ownerUsernameForMember,
	selectOtherCharNames,
	topActiveKeys,
} from './channelActivity.mjs'
import {
	buildChatLogEntryFromCharReply,
} from './logEntries.mjs'
import { chatLogEntry_t } from './models.mjs'
import { resolveChar, resolveLocalPlugins, resolvePersona, resolveWorld } from './resolvePart.mjs'
import { getGroupRuntime } from './runtime.mjs'
import { applyPersonaChatLogView, applyWorldChatLogView, resolveViewerRoles } from './viewerLog.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/** 窗口内 otherChars 活跃 Top-N 缺省 */
const DEFAULT_OTHER_CHARS_ACTIVE_LIMIT = 8

/**
 * 构建角色回复用的 prompt 结构（chat_log 来自 DAG；part 经 resolvePart）。
 * @param {string} groupId 群组 ID
 * @param {string} [charname] 角色名
 * @param {string | null} [channelId] 频道 ID
 * @param {object} [options] 选项
 * @param {string} [options.replicaUsername] replica 所有者
 * @returns {Promise<object>} prompt 请求载荷
 */
export async function getChatRequest(groupId, charname, channelId = null, options = {}) {
	const replicaUsername = options.replicaUsername || groupMetadatas.get(groupId)?.username
	if (!replicaUsername) throw new Error('Group not found')

	const chatMetadata = await getGroupRuntime(groupId, replicaUsername)
	const timeSlice = chatMetadata.LastTimeSlice
	const locales = [...new Set([
		...getUserByUsername(replicaUsername)?.locales ?? [],
		...localhostLocales,
	])]

	const charPart = charname ? await resolveChar(groupId, charname, replicaUsername) : undefined
	const playerPart = timeSlice.player
	const userinfo = await getPartInfo(playerPart, locales) || {}
	const charinfo = charPart ? await getPartInfo(charPart, locales) || {} : {}
	const UserCharname = userinfo.name || timeSlice.player_id || replicaUsername

	const { state } = await getState(replicaUsername, groupId)
	const member_roles = await resolveViewerRoles(state, { charname, replicaUsername, groupId })

	let effectiveChannelId = resolveChannelId(channelId, '')
	if (!effectiveChannelId)
		for (let index = chatMetadata.chatLog.length - 1; index >= 0; index--) {
			const fromLog = resolveChannelId(chatMetadata.chatLog[index].extension?.groupChannelId, '')
			if (fromLog) {
				effectiveChannelId = fromLog
				break
			}
		}

	if (!effectiveChannelId)
		effectiveChannelId = await resolveGroupChannelId(replicaUsername, groupId, null)

	const lines = await readChannelMessagesForUser(replicaUsername, groupId, effectiveChannelId, { limit: 500 })
	const activity = aggregateChannelActivity(lines)
	const activeLimit = Number(state.groupSettings?.otherCharsActiveLimit)
	const otherCharsLimit = Number.isFinite(activeLimit) && activeLimit > 0
		? activeLimit
		: DEFAULT_OTHER_CHARS_ACTIVE_LIMIT

	const otherCharNames = selectOtherCharNames(
		Object.keys(state.session?.chars || {}),
		charname,
		state.session?.charFrequencies,
		activity.chars,
		otherCharsLimit,
	)
	const other_chars = {}
	for (const name of otherCharNames) {
		const other = await resolveChar(groupId, name, replicaUsername)
		if (other) other_chars[name] = other
	}

	const localMemberKey = await resolveActiveMemberKeyForLocalUser(replicaUsername, groupId, state)
	/** @type {Record<string, { last_active: number, count: number }>} */
	const personaActivityByOwner = {}
	for (const [memberKey, stat] of Object.entries(activity.humans)) {
		const owner = ownerUsernameForMember(state, memberKey, replicaUsername, localMemberKey)
		if (!owner || owner === replicaUsername) continue
		const prev = personaActivityByOwner[owner]
		personaActivityByOwner[owner] = prev
			? {
				last_active: Math.max(prev.last_active, stat.last_active),
				count: prev.count + stat.count,
			}
			: { ...stat }
	}
	const other_personas = {}
	for (const owner of topActiveKeys(personaActivityByOwner, otherCharsLimit)) {
		if (!state.session?.personas?.[owner]) continue
		const persona = await resolvePersona(groupId, owner, replicaUsername)
		if (persona) other_personas[owner] = persona
	}

	const resolvedWorld = await resolveWorld(groupId, effectiveChannelId, replicaUsername)
	const localPlugins = await resolveLocalPlugins(groupId, replicaUsername)

	const i18n = await loadDagHydrationI18n(replicaUsername)
	const prelude = chatMetadata.chatLog.filter(entry => entry.extension.timeSlice?.greeting_type)
	const channelEntries = await buildChatLogEntriesFromChannelLines(
		lines,
		chatMetadata.LastTimeSlice,
		i18n,
		effectiveChannelId,
		replicaUsername,
		groupId,
		state,
	)
	const chatLogForRequest = [...prelude, ...channelEntries].sort((a, b) =>
		new Date(a.time_stamp).getTime() - new Date(b.time_stamp).getTime())

	const UserUid = await getOperatorEntityHash(replicaUsername)
	const memberId = charname
		? await ensureLocalAgentEntityHash(replicaUsername, charname)
		: UserUid
	const CharUid = charname ? memberId : ''

	const declaredOwnerEntityHash = charname && memberId
		? await resolveDeclaredOwnerEntityHash(replicaUsername, memberId)
		: null

	let ReplyToCharname = options.ReplyToCharname
	let ReplyToUid = options.ReplyToUid
	if (ReplyToCharname == null && ReplyToUid == null) 
		for (let index = chatLogForRequest.length - 1; index >= 0; index--) {
			const replyTo = chatLogForRequest[index]?.extension?.replyTo
			if (!replyTo) continue
			ReplyToCharname = replyTo.senderName || undefined
			ReplyToUid = replyTo.senderEntityHash || undefined
			break
		}
	

	/** @type {import('../../../../../../../decl/chatLog.ts').chatReplyRequest_t} */
	const chatReplyRequest = {
		supported_functions: {
			markdown: true,
			mathjax: true,
			html: true,
			unsafe_html: true,
			files: true,
			add_message: true,
			fount_assets: true,
			fount_i18nkeys: true,
			fount_themes: true,
		},
		chat_name: 'common_chat_' + groupId,
		char_id: charname,
		username: replicaUsername,
		UserCharname,
		UserUid: UserUid || '',
		Charname: charname ? charinfo.name || charname : '',
		CharUid,
		...ReplyToCharname != null ? { ReplyToCharname } : {},
		...ReplyToUid != null ? { ReplyToUid } : {},
		locales,
		chat_log: chatLogForRequest,
		timelines: chatMetadata.timeLines,
		member_roles,
		/**
		 * @returns {Promise<object>} 刷新后的请求上下文
		 */
		Update: () => getChatRequest(groupId, charname, channelId, options),
		/**
		 * @param {object} entry 角色回复结果
		 * @returns {Promise<chatLogEntry_t>} 写入后的日志条目
		 */
		AddChatLogEntry: async entry => {
			if (!charname) throw new Error('Char not in this chat')
			const localChar = await resolveChar(groupId, charname, replicaUsername)
			if (!localChar) throw new Error('Char not in this chat')
			const { addChatLogEntry } = await import('./chatLogAppend.mjs')
			return addChatLogEntry(groupId, await buildChatLogEntryFromCharReply(
				entry,
				chatMetadata.LastTimeSlice.copy(),
				localChar,
				charname,
				replicaUsername,
			))
		},
		world: resolvedWorld,
		char: charPart,
		user: playerPart,
		other_chars,
		other_personas,
		chat_scoped_char_memory: charname ? timeSlice.chars_memories[charname] ??= {} : {},
		plugins: localPlugins,
		extension: {
			groupId,
			channelId: effectiveChannelId,
			memberId,
			member_roles,
			channelActivity: {
				chars: activity.chars,
				humans: activity.humans,
				personas: personaActivityByOwner,
			},
			...declaredOwnerEntityHash ? { declaredOwnerEntityHash } : {},
			...state.groupSettings?.bridge ? { bridge: state.groupSettings.bridge } : {},
		},
	}

	// world 插件活对象 + 本机名单；同名本机优先。GetChatPlugins 不可 RPC（hosted 仅主机侧生效）。
	const worldPlugins = await resolvedWorld.interfaces?.chat?.GetChatPlugins?.(chatReplyRequest) || {}
	chatReplyRequest.plugins = injectFountChatCodeContextPlugin({ ...worldPlugins, ...localPlugins })

	for (const logEntry of chatReplyRequest.chat_log)
		await hydrateLogContextFromSidecar(
			replicaUsername,
			groupId,
			sidecarChannelForEntry(logEntry, effectiveChannelId),
			logEntry,
		)

	/** @type {import('../../../../../../../decl/chatLog.ts').chatViewer_t} */
	const viewer = {
		kind: charname ? 'char' : 'user',
		memberId,
		ownerUsername: replicaUsername,
		channelId: effectiveChannelId,
		...charname && { charname, entityHash: memberId },
		roles: member_roles,
	}
	chatReplyRequest.chat_log = await applyWorldChatLogView(chatReplyRequest, viewer)
	chatReplyRequest.chat_log = await applyPersonaChatLogView(chatReplyRequest, viewer)

	if (charname && charPart) {
		const cap = charPart.contextLength ?? charPart.extension?.contextLength
		if (cap > 0 && chatReplyRequest.chat_log.length > cap)
			chatReplyRequest.chat_log = chatReplyRequest.chat_log.slice(-cap)
	}

	return chatReplyRequest
}

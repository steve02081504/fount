/**
 * 【文件】chatRequest.mjs — 角色 GetReply 用的 chatReplyRequest 构建
 * 【职责】getChatRequest 组装 decl/chatLog 定义的 prompt 结构：合并内存 prelude、DAG 频道消息水合的 chat_log、解析的世界/角色/插件、侧车 logContext 与可选跨机 persona。
 * 【原理】readChannelMessagesForUser + buildChatLogEntriesFromChannelLines 构成主日志；resolveChar/World/LocalPlugins 支持联邦；世界可裁剪 GetChatLogForCharname；角色 contextLength 截断；extension 含 groupId/channelId/memberId entity hash。
 * 【数据结构】chatReplyRequest_t（chat_log、timelines、AddChatLogEntry、Update、supported_functions、extension）。
 * 【关联】runtime、resolvePart、hydration、group/queries、generation、triggerReply。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */


import { localhostLocales } from '../../../../../../../scripts/i18n/bare.mjs'
import { getPartInfo } from '../../../../../../../scripts/locale.mjs'
import { agentEntityHash } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { getUserByUsername } from '../../../../../../../server/auth/index.mjs'
import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import {
	buildChatLogEntriesFromChannelLines,
	loadDagHydrationI18n,
} from '../dag/hydration.mjs'
import { resolveChannelId, resolveGroupChannelId } from '../lib/channelId.mjs'
import { hydrateLogContextFromSidecar, sidecarChannelForEntry } from '../lib/contextSidecar.mjs'
import { getLocalNodeHash, getOperatorEntityHash } from '../lib/replica.mjs'

import { getMaterializedSession } from './dagSession.mjs'
import {
	buildChatLogEntryFromCharReply,
} from './logEntries.mjs'
import { chatLogEntry_t } from './models.mjs'
import { resolveChar, resolveLocalPlugins, resolveWorld } from './resolvePart.mjs'
import { getGroupRuntime } from './runtime.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 构建角色回复用的 prompt 结构（chat_log 来自 DAG；part 经 resolvePart）。
 * @param {string} groupId 群组 ID
 * @param {string} [charname] 角色名
 * @param {string | null} [channelId] 频道 ID
 * @param {object} [options] 选项
 * @param {string} [options.replicaUsername] replica 所有者
 * @param {object} [options.personaForOther] 跨机人格 `{ ownerUsername, personaname, displayName? }`
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

	const session = await getMaterializedSession(replicaUsername, groupId)
	const other_chars = {}
	for (const name of Object.keys(session.chars || {})) {
		if (name === charname) continue
		const other = await resolveChar(groupId, name, replicaUsername)
		if (other) other_chars[name] = other
	}

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

	const resolvedWorld = await resolveWorld(groupId, effectiveChannelId, replicaUsername)
	const plugins = await resolveLocalPlugins(groupId, replicaUsername)

	let chatLogForRequest = chatMetadata.chatLog
	const lines = await readChannelMessagesForUser(replicaUsername, groupId, effectiveChannelId, { limit: 500 })
	const i18n = await loadDagHydrationI18n(replicaUsername)
	const prelude = chatMetadata.chatLog.filter(entry => entry.extension.timeSlice?.greeting_type)
	const channelEntries = await buildChatLogEntriesFromChannelLines(
		lines,
		chatMetadata.LastTimeSlice,
		i18n,
		effectiveChannelId,
		replicaUsername,
		groupId,
	)
	chatLogForRequest = [...prelude, ...channelEntries].sort((a, b) =>
		new Date(a.time_stamp).getTime() - new Date(b.time_stamp).getTime())

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
		Charname: charname ? charinfo.name || charname : '',
		locales,
		chat_log: chatLogForRequest,
		timelines: chatMetadata.timeLines,
		member_roles: [],
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
		world: resolvedWorld ?? undefined,
		char: charPart,
		user: playerPart,
		other_chars,
		chat_scoped_char_memory: charname ? timeSlice.chars_memories[charname] ??= {} : {},
		plugins,
		extension: {
			groupId,
			channelId: effectiveChannelId,
			memberId: charname
				? agentEntityHash(getLocalNodeHash(), `chars/${charname}`)
				: await getOperatorEntityHash(replicaUsername),
			member_roles: [],
			personaForOther: options.personaForOther || undefined,
		},
	}

	for (const logEntry of chatReplyRequest.chat_log)
		await hydrateLogContextFromSidecar(
			replicaUsername,
			groupId,
			sidecarChannelForEntry(logEntry, effectiveChannelId),
			logEntry,
		)

	if (resolvedWorld?.interfaces?.chat?.GetChatLogForCharname && charname)
		chatReplyRequest.chat_log = await resolvedWorld.interfaces.chat.GetChatLogForCharname(chatReplyRequest, charname)

	if (charname && charPart) {
		const cap = charPart.contextLength ?? charPart.extension?.contextLength
		if (cap > 0 && chatReplyRequest.chat_log.length > cap)
			chatReplyRequest.chat_log = chatReplyRequest.chat_log.slice(-cap)
	}

	if (options.personaForOther?.personaname) {
		const owner = options.personaForOther.ownerUsername
		if (owner && owner !== replicaUsername) {
			const personaPart = await loadPart(owner, `personas/${options.personaForOther.personaname}`)
			if (personaPart)
				chatReplyRequest.extension = {
					...chatReplyRequest.extension,
					otherPersona: personaPart,
					otherPersonaDisplayName: options.personaForOther.displayName,
				}
		}
	}

	return chatReplyRequest
}

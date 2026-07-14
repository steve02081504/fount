/**
 * 【文件】partConfig.mjs — 会话部件配置（人格/世界/角色/插件）与 DAG 事件写入
 * 【职责】setPersona/setWorld/addchar/removechar/addplugin/removeplugin/setCharSpeakingFrequency；读写物化 session 并 rebuildGroupRuntime；问候语插入；getCharList/getChatLog 等查询。
 * 【原理】每次变更 appendSession* 签名事件到 DAG 后 rebuildGroupRuntime 刷新内存；setWorld/addchar 在合适 greeting_type 下调用 GetGreeting/GetGroupGreeting 并经 addChatLogEntry 落盘；广播对应 persona_set/world_set/char_added 等事件。
 * 【数据结构】物化 session 绑定（ownerUsername + homeNodeHash）；chatMetadata.LastTimeSlice、channelWorlds Map。
 * 【关联】dagSession、runtime、broadcast、generation、profile sync、endpoints。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { syncEntityProfileFromPersona } from '../../profile/syncFromPersona.mjs'
import { getState } from '../dag/materialize.mjs'
import { getDefaultChannelId } from '../dag/queries.mjs'
import { isExpectedTeardownRace } from '../lib/expectedTeardownRace.mjs'

import { broadcastGroupEvent } from './broadcast.mjs'
import { addChatLogEntry } from './chatLogAppend.mjs'
import { getChatRequest } from './chatRequest.mjs'
import {
	appendAgentMemberJoin,
	appendAgentMemberKick,
	appendAgentReplyFrequencySet,
	appendSessionChannelWorldBind,
	appendSessionPersonaSet,
	appendSessionPluginAdd,
	appendSessionPluginRemove,
	getMaterializedSession,
	sessionHasChar,
} from './dagSession.mjs'
import { buildChatLogEntryFromCharReply } from './logEntries.mjs'
import { resolveWorld } from './resolvePart.mjs'
import {
	getGroupRuntime,
	getSessionCharNames,
	rebuildGroupRuntime,
} from './runtime.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/** @type {Map<string, Set<string>>} groupId → 待插入问候的角色名 */
const pendingCharGreetings = new Map()

/**
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @returns {void}
 */
function trackPendingCharGreeting(groupId, charname) {
	let set = pendingCharGreetings.get(groupId)
	if (!set) {
		set = new Set()
		pendingCharGreetings.set(groupId, set)
	}
	set.add(charname)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @returns {void}
 */
function untrackPendingCharGreeting(groupId, charname) {
	const set = pendingCharGreetings.get(groupId)
	if (!set) return
	set.delete(charname)
	if (!set.size) pendingCharGreetings.delete(groupId)
}

/**
 * 后台插入问候语（带 pending 追踪与错误处理）。
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {string} username replica
 * @param {string | undefined} greetingType 问候类型
 * @returns {Promise<void>}
 */
async function runDeferredCharGreeting(groupId, charname, username, greetingType) {
	trackPendingCharGreeting(groupId, charname)
	try {
		if (groupMetadatas.get(groupId)?.username !== username) return
		const chatMetadata = await getGroupRuntime(groupId, username)
		if (!chatMetadata.LastTimeSlice.chars[charname]) return
		const liveTimeSlice = chatMetadata.LastTimeSlice.copy()
		liveTimeSlice.greeting_type = greetingType
		await insertCharGreeting(groupId, charname, username, chatMetadata, liveTimeSlice)
	}
	catch (error) {
		if (!isExpectedTeardownRace(error))
			console.error(`deferred char greeting failed (${groupId}/${charname}):`, error)
	}
	finally {
		untrackPendingCharGreeting(groupId, charname)
	}
}

/**
 * @param {string} groupId 群 ID
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<{ username: string, metadata: import('./models.mjs').chatMetadata_t }>} replica 与群元数据
 */
async function resolveReplica(groupId, replicaUsername) {
	const username = replicaUsername || groupMetadatas.get(groupId)?.username
	if (!username) throw new Error('Group not found')
	const metadata = await getGroupRuntime(groupId, username)
	return { username, metadata }
}

/**
 * 设置当前聊天使用的人格并广播 persona_set。
 * @param {string} groupId 聊天 ID
 * @param {string} [personaname] 人格名；空则清除
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<void>}
 */
export async function setPersona(groupId, personaname, replicaUsername) {
	const { username } = await resolveReplica(groupId, replicaUsername)
	await appendSessionPersonaSet(username, groupId, personaname || null)
	await rebuildGroupRuntime(groupId, username)
	await syncEntityProfileFromPersona(username, groupId)
	broadcastGroupEvent(groupId, { type: 'persona_set', payload: { personaname } })
}

/**
 * 设置指定频道的世界书，并可能插入世界问候消息。
 * @param {string} groupId 群组 ID（同 groupId）
 * @param {string} channelId 频道 ID
 * @param {string | null} worldname 世界名；空则清除该频道世界
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<chatLogEntry_t | null>} 问候条目或 null
 */
export async function setWorld(groupId, channelId, worldname, replicaUsername) {
	channelId = channelId ?? 'default'
	const { username } = await resolveReplica(groupId, replicaUsername)
	if (!worldname)
		await appendSessionChannelWorldBind(username, groupId, channelId, null)
	else
		await appendSessionChannelWorldBind(username, groupId, channelId, worldname)

	const chatMetadata = await rebuildGroupRuntime(groupId, username)
	broadcastGroupEvent(groupId, { type: 'world_set', payload: { channelId, worldname } })

	if (!worldname) return null

	// LastTimeSlice.world 只反映默认频道；问候必须按 channelId 解析
	const world = await resolveWorld(groupId, channelId, username)
	chatMetadata.LastTimeSlice.world = world
	chatMetadata.LastTimeSlice.world_id = worldname

	const timeSlice = chatMetadata.LastTimeSlice.copy()
	if (world.interfaces.chat.GetGreeting && !chatMetadata.chatLog.length)
		timeSlice.greeting_type = 'world_single'
	else if (world.interfaces.chat.GetGroupGreeting && chatMetadata.chatLog.length)
		timeSlice.greeting_type = 'world_group'

	try {
		const request = await getChatRequest(groupId, undefined, channelId, { replicaUsername: username })
		let result
		switch (timeSlice.greeting_type) {
			case 'world_single':
				result = await world.interfaces.chat.GetGreeting(request, 0)
				break
			case 'world_group':
				result = await world.interfaces.chat.GetGroupGreeting(request, 0)
				break
		}
		if (!result) return null

		const greetingEntry = await buildChatLogEntryFromCharReply(result, timeSlice, null, undefined, username)
		await addChatLogEntry(groupId, greetingEntry)
		return greetingEntry
	}
	catch (error) {
		if (!isExpectedTeardownRace(error))
			console.error('setWorld greeting failed:', error)
		return null
	}
}

/**
 * 向聊天添加角色并尝试插入问候。
 * @param {string} groupId 聊天 ID
 * @param {string} charname 角色名
 * @param {string} [replicaUsername] 本地账户名
 * @returns {Promise<chatLogEntry_t | null>} 问候条目或 null
 */
/**
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @param {string} username replica 所有者
 * @param {import('./models.mjs').chatMetadata_t} chatMetadata 群运行时
 * @param {object} timeSlice 时间片副本
 * @returns {Promise<chatLogEntry_t | null>} 问候日志条目或 null
 */
async function insertCharGreeting(groupId, charname, username, chatMetadata, timeSlice) {
	const char = timeSlice.chars[charname]
	if (!char) return null
	const getGreeting = timeSlice.greeting_type === 'group'
		? char.interfaces?.chat?.GetGroupGreeting || char.interfaces?.chat?.GetGreeting
		: char.interfaces?.chat?.GetGreeting
	if (!getGreeting) return null
	const request = await getChatRequest(groupId, charname, await getDefaultChannelId(username, groupId), { replicaUsername: username })
	try {
		const result = await getGreeting(request, 0)
		if (!result) return null
		const greetingEntry = await buildChatLogEntryFromCharReply(result, timeSlice, char, charname, username)
		greetingEntry.extension = {
			...greetingEntry.extension || {},
			isGreeting: true,
			greetingType: timeSlice.greeting_type || greetingEntry.extension?.timeSlice?.greeting_type,
		}
		if (greetingEntry.extension.timeSlice?.greeting_type)
			delete greetingEntry.extension.timeSlice.greeting_type
		await addChatLogEntry(groupId, greetingEntry)
		return greetingEntry
	}
	catch (error) {
		if (!isExpectedTeardownRace(error))
			console.error(error)
		return null
	}
}

/**
 * @param {string} groupId 聊天 ID
 * @param {string} charname 角色名
 * @param {string} [replicaUsername] 本地账户名
 * @param {{ deferGreeting?: boolean }} [opts] `deferGreeting` 时先返回 HTTP，问候语后台插入
 * @returns {Promise<chatLogEntry_t | null>} 问候条目或 null
 */
export async function addchar(groupId, charname, replicaUsername, opts = {}) {
	const { username } = await resolveReplica(groupId, replicaUsername)
	const { ensureLocalAgentEntityHash } = await import('../../entity/member.mjs')
	await ensureLocalAgentEntityHash(username, charname)
	const session = await getMaterializedSession(username, groupId)
	if (sessionHasChar(session, charname)) {
		const chatMetadata = await getGroupRuntime(groupId, username)
		if (chatMetadata.LastTimeSlice.chars[charname]) return null
	}

	const { state: groupState } = await getState(username, groupId)
	const isCharFriendChat = !!groupState.groupMeta?.friendBinding?.charname
	await appendAgentMemberJoin(username, groupId, charname, {
		roles: isCharFriendChat ? ['admin'] : undefined,
		...opts.appendOpts || {},
	})
	const chatMetadata = await rebuildGroupRuntime(groupId, username)
	const timeSlice = chatMetadata.LastTimeSlice.copy()
	if (Object.keys(timeSlice.chars).length > 1)
		timeSlice.greeting_type = 'group'
	else
		timeSlice.greeting_type = 'single'

	const char = timeSlice.chars[charname]
	if (!char) return null

	broadcastGroupEvent(groupId, { type: 'char_added', payload: { charname } })

	if (opts.deferGreeting) {
		void runDeferredCharGreeting(groupId, charname, username, timeSlice.greeting_type)
		return null
	}
	return insertCharGreeting(groupId, charname, username, chatMetadata, timeSlice)
}

/**
 * 从聊天移除角色并广播 char_removed。
 * @param {string} groupId 聊天 ID
 * @param {string} charname 角色名
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<void>}
 */
export async function removechar(groupId, charname, replicaUsername) {
	const { username } = await resolveReplica(groupId, replicaUsername)
	await appendAgentMemberKick(username, groupId, charname)
	await rebuildGroupRuntime(groupId, username)
	broadcastGroupEvent(groupId, { type: 'char_removed', payload: { charname } })
}

/**
 * 向聊天添加插件部件并广播 plugin_added。
 * @param {string} groupId 聊天 ID
 * @param {string} pluginname 插件名
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<void>}
 */
export async function addplugin(groupId, pluginname, replicaUsername) {
	const { username } = await resolveReplica(groupId, replicaUsername)
	await appendSessionPluginAdd(username, groupId, pluginname)
	await rebuildGroupRuntime(groupId, username)
	broadcastGroupEvent(groupId, { type: 'plugin_added', payload: { pluginname } })
}

/**
 * 从聊天移除插件并广播 plugin_removed。
 * @param {string} groupId 聊天 ID
 * @param {string} pluginname 插件名
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<void>}
 */
export async function removeplugin(groupId, pluginname, replicaUsername) {
	const { username } = await resolveReplica(groupId, replicaUsername)
	await appendSessionPluginRemove(username, groupId, pluginname)
	await rebuildGroupRuntime(groupId, username)
	broadcastGroupEvent(groupId, { type: 'plugin_removed', payload: { pluginname } })
}

/**
 * 设置聊天中特定角色的发言频率。
 * @param {string} groupId 聊天 ID
 * @param {string} charname 角色名
 * @param {number} frequency 发言频率乘数
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<void>}
 */
export async function setCharSpeakingFrequency(groupId, charname, frequency, replicaUsername) {
	const { username } = await resolveReplica(groupId, replicaUsername)
	await appendAgentReplyFrequencySet(username, groupId, charname, frequency)
	await rebuildGroupRuntime(groupId, username)
	broadcastGroupEvent(groupId, { type: 'char_frequency_set', payload: { charname, frequency } })
}

/**
 * 返回当前聊天已绑定的角色 ID 列表。
 * @param {string} groupId 聊天 ID
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<string[]>} 角色名数组
 */
export async function getCharListOfGroup(groupId, replicaUsername) {
	if (!replicaUsername) {
		const entry = groupMetadatas.get(groupId)
		if (!entry?.username) return []
		return getSessionCharNames(groupId, entry.username)
	}
	return getSessionCharNames(groupId, replicaUsername)
}

/**
 * 返回当前聊天已加载的插件 ID 列表。
 * @param {string} groupId 聊天 ID
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<string[]>} 插件名数组
 */
export async function getPluginListOfGroup(groupId, replicaUsername) {
	const username = replicaUsername || groupMetadatas.get(groupId)?.username
	if (!username) return []
	const session = await getMaterializedSession(username, groupId)
	return [...session.plugins?.[username] || []]
}

/**
 * 返回内存中聊天日志的切片。
 * @param {string} groupId 群组 ID
 * @param {number} start 起始索引
 * @param {number} end 结束索引（不含）
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<chatLogEntry_t[]>} 日志条目数组
 */
export async function getChatLog(groupId, start, end, replicaUsername) {
	const username = replicaUsername || groupMetadatas.get(groupId)?.username
	if (!username) return []
	const meta = await getGroupRuntime(groupId, username)
	return meta.chatLog.slice(start, end)
}

/**
 * 返回内存中聊天日志条数。
 * @param {string} groupId 群组 ID
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<number>} 条数
 */
export async function getChatLogLength(groupId, replicaUsername) {
	const username = replicaUsername || groupMetadatas.get(groupId)?.username
	if (!username) return 0
	const meta = await getGroupRuntime(groupId, username)
	return meta.chatLog.length
}

/**
 * 返回当前聊天绑定的人格 ID。
 * @param {string} groupId 聊天 ID
 * @param {string} [replicaUsername] replica 所有者
 * @returns {Promise<string | undefined>} 人格名
 */
export async function getUserPersonaName(groupId, replicaUsername) {
	const username = replicaUsername || groupMetadatas.get(groupId)?.username
	if (!username) return undefined
	const session = await getMaterializedSession(username, groupId)
	return session.personas?.[username] || undefined
}

/**
 * 从物化 state 读取群级世界名。
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<string | null>} 世界名或 null
 */
export async function getSessionWorldName(groupId, channelId, replicaUsername) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	const channelBind = session.channelWorlds?.[channelId]
	if (channelBind?.worldname) return channelBind.worldname
	return session.world?.worldname || null
}

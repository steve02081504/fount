/**
 * 【文件】runtime.mjs — 群 AI runtime 物化与 timeSlice 构建
 * 【职责】在 groupMetadatas 中注册/失效群槽位；从 DAG 物化 session 构建 LastTimeSlice 并 hydrate chatLog；提供角色绑定查询与本机节点判断；支持从 message 内嵌 session 快照还原 timeSlice。
 * 【原理】getGroupRuntime 缓存 chatMetadata，未命中时 getMaterializedSession + buildTimeSliceFromSession + hydrateChatLogFromDag；仅 homeNodeHash 为本机的 part 才 loadPart，跨机 part 由 resolvePart 代理；rebuildGroupRuntime 置空缓存后重建。
 * 【数据结构】groupMetadatas 条目中的 chatMetadata（chatMetadata_t）；物化 session 的 chars/world/channelWorlds/personas/plugins/charFrequencies。
 * 【关联】dagSession、models、wsLifecycle、hydration、resolvePart、partConfig。
 */
import { loadPart } from '../../../../../../../server/parts_loader.mjs'
import { hydrateChatLogFromDag } from '../dag/hydration.mjs'
import { ensureGroup } from '../dag/lifecycle.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'
import { scheduleVoteDeadlines } from '../lib/voteDeadlineWatcher.mjs'
import { registerGroupReplicaForUser } from '../ws/groupWsRooms.mjs'

import { getMaterializedSession } from './dagSession.mjs'
import { chatMetadata_t, timeSlice_t } from './models.mjs'
import { loadPlayerForReplica, loadPluginsForReplica } from './timeSliceParts.mjs'
import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 注册群 runtime 槽位（仅内存；正文由 DAG 物化）。
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {void}
 */
export function registerGroupRuntime(groupId, replicaUsername) {
	if (!groupMetadatas.has(groupId))
		groupMetadatas.set(groupId, { username: replicaUsername, chatMetadata: null })
	registerGroupReplicaForUser(groupId)
	void scheduleVoteDeadlines(replicaUsername, groupId)
}

/**
 * 使群 runtime 缓存失效，下次加载时从 DAG 重建。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function invalidateGroupRuntime(groupId) {
	const entry = groupMetadatas.get(groupId)
	if (entry) entry.chatMetadata = null
}

/**
 * 从物化 session 构建 timeSlice（仅加载本机归属的 part 对象）。
 * @param {object} session 物化 session
 * @param {string} replicaUsername 当前 replica
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 频道 ID（频道世界）
 * @returns {Promise<timeSlice_t>} 仅含本机已加载 part 的时间切片
 */
export async function buildTimeSliceFromSession(session, replicaUsername, groupId, channelId) {
	const slice = new timeSlice_t()
	const localNode = getLocalNodeHash()
	const effectiveChannelId = channelId || 'default'

	/**
	 * @param {string} charname 角色名
	 * @param {{ ownerUsername?: string, homeNodeHash: string }} bind 绑定信息
	 * @returns {Promise<void>}
	 */
	const bindChar = async (charname, bind) => {
		if (!charname || !bind) return
		const owner = bind.ownerUsername || replicaUsername
		if (bind.homeNodeHash === localNode)
			slice.chars[charname] = await loadPart(owner, `chars/${charname}`)
	}

	for (const [charname, bind] of Object.entries(session?.chars || {}))
		await bindChar(charname, bind)

	// 非本机/未绑定时保留构造缺省 BUILTIN_WORLD
	const worldBind = session?.channelWorlds?.[effectiveChannelId]
		|| session?.world
	if (worldBind?.worldname && worldBind.homeNodeHash === localNode) {
		const owner = worldBind.ownerUsername || replicaUsername
		slice.world = await loadPart(owner, `worlds/${worldBind.worldname}`)
		slice.world_id = worldBind.worldname
	}

	Object.assign(slice, await loadPlayerForReplica(replicaUsername, session?.personas))
	Object.assign(slice.plugins, await loadPluginsForReplica(replicaUsername, session?.plugins))

	for (const [charname, frequency] of Object.entries(session?.charFrequencies || {}))
		slice.chars_speaking_frequency[charname] = frequency

	return slice
}

/**
 * 从 DAG 物化并缓存群 AI runtime。
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<import('./models.mjs').chatMetadata_t>} 群 AI runtime 元数据
 */
export async function getGroupRuntime(groupId, replicaUsername) {
	if (!replicaUsername) throw new Error('replicaUsername required')
	registerGroupRuntime(groupId, replicaUsername)
	await ensureGroup(replicaUsername, groupId)

	const entry = groupMetadatas.get(groupId)
	if (!entry?.chatMetadata) {
		const session = await getMaterializedSession(replicaUsername, groupId)
		const metadata = new chatMetadata_t(replicaUsername)
		metadata.LastTimeSlice = await buildTimeSliceFromSession(session, replicaUsername, groupId)
		metadata.channelWorlds = new Map()
		for (const [channelId, bind] of Object.entries(session?.channelWorlds || {}))
			if (bind?.worldname) metadata.channelWorlds.set(channelId, bind.worldname)

		await hydrateChatLogFromDag(replicaUsername, groupId, metadata)
		entry.chatMetadata = metadata
	}
	return entry.chatMetadata
}

/**
 * 从 DAG 重建 runtime 缓存（session 事件写入后调用）。
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<import('./models.mjs').chatMetadata_t>} 重建后的元数据
 */
export async function rebuildGroupRuntime(groupId, replicaUsername) {
	invalidateGroupRuntime(groupId)
	return getGroupRuntime(groupId, replicaUsername)
}

/**
 * @param {string} groupId 群 ID
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<string[]>} 已绑定角色名
 */
export async function getSessionCharNames(groupId, replicaUsername) {
	const session = await getMaterializedSession(replicaUsername, groupId)
	return Object.keys(session.chars || {})
}

/**
 * @param {object} session 物化 session
 * @param {string} charname 角色名
 * @returns {{ ownerUsername: string, homeNodeHash: string } | null} 绑定信息或 null
 */
export function getCharBind(session, charname) {
	return session?.chars?.[charname] || null
}

/**
 * @param {string} homeNodeHash 目标节点
 * @param {string} replicaUsername 当前 replica
 * @returns {boolean} 是否为本机节点
 */
export function isLocalNode(homeNodeHash, replicaUsername) {
	return homeNodeHash === getLocalNodeHash()
}

/**
 * 从 DAG message 内嵌的 session 快照构建 timeSlice（仅加载本机 part）。
 * @param {object} snapshot `exportSessionSnapshot` 形状
 * @param {string} replicaUsername 当前 replica
 * @param {string} groupId 群 ID
 * @param {string} [channelId] 频道 ID
 * @returns {Promise<timeSlice_t>} 还原的时间切片
 */
export async function buildTimeSliceFromSessionSnapshot(snapshot, replicaUsername, groupId, channelId) {
	if (!snapshot) return buildTimeSliceFromSession({
		chars: {},
		world: null,
		channelWorlds: {},
		personas: {},
		plugins: {},
		charFrequencies: {},
	}, replicaUsername, groupId, channelId)
	return buildTimeSliceFromSession({
		chars: snapshot.chars || {},
		world: snapshot.world || null,
		channelWorlds: channelId && snapshot.world ? { [channelId]: snapshot.world } : {},
		personas: snapshot.personas || {},
		plugins: snapshot.plugins || {},
		charFrequencies: snapshot.charFrequencies || {},
	}, replicaUsername, groupId, channelId)
}

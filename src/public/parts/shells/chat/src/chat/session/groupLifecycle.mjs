/**
 * 【文件】groupLifecycle.mjs — 群会话生命周期
 * 【职责】newGroup/deleteGroup、newMetadata、findEmptyGroupId；监听用户删除/重命名清理 groupMetadatas。
 * 【关联】dag/lifecycle、wsLifecycle、partConfig、runtime。
 */
import { geti18nForUser } from '../../../../../../../scripts/i18n/index.mjs'
import { events } from '../../../../../../../server/events.mjs'
import { createGroup, removeLocalGroupReplica } from '../dag/lifecycle.mjs'
import { getLocalSignerForNewGroup } from '../dag/localSigner.mjs'
import { rebuildAndSaveCheckpoint } from '../dag/materialize.mjs'

import {
	appendSessionPersonaSet,
	appendSessionWorldBind,
} from './dagSession.mjs'
import { setLocalPluginNames } from './localPlugins.mjs'
import { chatMetadata_t } from './models.mjs'
import { registerGroupRuntime, rebuildGroupRuntime } from './runtime.mjs'
import { groupMetadatas, purgeGroupSession } from './wsLifecycle.mjs'

/**
 * 为指定的聊天 ID 创建一个新的、空的元数据实例。
 * @param {string} groupId 聊天 ID
 * @param {string} username 聊天的所有者用户名
 * @returns {Promise<void>}
 */
export async function newMetadata(groupId, username) {
	registerGroupRuntime(groupId, username)
	const defaults = await chatMetadata_t.StartNewAs(username)
	const batchOpts = { skipCheckpointRebuild: true, skipReleaseQuarantined: true, publishFederation: false }
	if (defaults.LastTimeSlice.player_id)
		await appendSessionPersonaSet(username, groupId, defaults.LastTimeSlice.player_id, batchOpts)
	if (defaults.LastTimeSlice.world_id)
		await appendSessionWorldBind(username, groupId, defaults.LastTimeSlice.world_id, batchOpts)
	await setLocalPluginNames(username, groupId, Object.keys(defaults.LastTimeSlice.plugins || {}))
	await rebuildAndSaveCheckpoint(username, groupId, { skipChannelGc: true })
	await rebuildGroupRuntime(groupId, username)
}

/**
 * 生成不与内存冲突的随机聊天 ID。
 * @returns {string} 可用 groupId
 */
export function findEmptyGroupId() {
	while (true) {
		const uuid = Math.random().toString(36).substring(2, 15)
		if (!groupMetadatas.has(uuid)) return uuid
	}
}

/**
 * 创建一个全新的聊天（每个聊天天然对应一个群，groupId 即 groupId）。
 * @param {string} username - 新聊天的所有者用户名。
 * @param {{ name?: string, defaultChannelName?: string, entityHash?: string, joinPolicy?: string }} [options] 群显示名 / 默认频道 / 建群实体（缺省 operator） / 入群策略
 * @returns {Promise<string>} 新创建的聊天的ID。
 */
export async function newGroup(username, options = {}) {
	const groupId = findEmptyGroupId()
	const entityHash = options.entityHash || undefined
	const { sender: ownerPubKeyHash, secretKey } = await getLocalSignerForNewGroup(username, groupId, entityHash)
	const result = await createGroup(username, {
		groupId,
		ownerPubKeyHash,
		secretKey,
		entityHash,
		name: options.name || await geti18nForUser(username, 'chat.group.defaults.dmChatName'),
		defaultChannelName: options.defaultChannelName,
		joinPolicy: options.joinPolicy,
	})
	registerGroupRuntime(result.groupId, username)
	await newMetadata(result.groupId, username)
	return result.groupId
}

/**
 * 删除一个或多个本地会话目录与 DAG 数据。
 * @param {string[]} groupIds 会话 ID 列表
 * @param {string} username 用户名
 * @returns {Promise<Array<{ groupId: string, error?: string }>>} 各群删除结果
 */
export async function deleteGroup(groupIds, username) {
	const deletePromises = groupIds.map(async groupId => {
		try {
			await removeLocalGroupReplica(username, groupId)
			return { groupId }
		}
		catch (error) {
			console.error(`Error deleting group ${groupId}:`, error)
			return { groupId, error: error.message }
		}
	})
	return Promise.all(deletePromises)
}

events.on('AfterUserDeleted', async payload => {
	const { username } = payload
	const groupIdsToDeleteFromCache = []
	for (const [groupId, data] of groupMetadatas.entries())
		if (data.username === username)
			groupIdsToDeleteFromCache.push(groupId)
	groupIdsToDeleteFromCache.forEach(groupId => purgeGroupSession(groupId))
})

events.on('AfterUserRenamed', async ({ oldUsername, newUsername }) => {
	for (const [groupId, data] of groupMetadatas.entries())
		if (data.username === oldUsername) {
			data.username = newUsername
			if (data.chatMetadata?.username === oldUsername)
				data.chatMetadata.username = newUsername
		}
})

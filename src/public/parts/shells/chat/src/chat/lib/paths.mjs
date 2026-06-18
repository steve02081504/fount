/**
 * 【文件】src/chat/lib/paths.mjs
 * 【职责】聊天数据目录路径助手：events、files、gsh、settings 等根路径拼接。
 * 【原理】基于 `@data/users/{user}/shells/chat/groups/{groupId}` 约定返回绝对路径常量函数。
 * 【数据结构】导出 eventsPath、filesPath、settingsPath 等路径函数。
 * 【关联】storage、dag/storage、files/blobStore、全 chat 子模块。
 */
import { join } from 'node:path'

import { getUserDictionary } from '../../../../../../../server/auth.mjs'

/**
 * 聊天 shell 根目录：`{userDict}/shells/chat`
 * @param {string} username 本地账户名
 * @returns {string} 根目录绝对路径
 */
export function shellChatRoot(username) {
	return join(getUserDictionary(username), 'shells', 'chat')
}

/**
 * 用户级群发现索引（联邦 gossip 合并结果）。
 * @param {string} username 用户
 * @returns {string} `discovery.json` 绝对路径
 */
export function discoveryIndexPath(username) {
	return join(shellChatRoot(username), 'discovery.json')
}

/**
 * 单个群 / 会话在磁盘上的 DAG 数据目录。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组或会话 ID
 * @returns {string} 群目录绝对路径
 */
export function groupDir(username, groupId) {
	return join(shellChatRoot(username), 'groups', groupId)
}

/**
 * @param {string} username 本地账户名
 * @param {string} groupId 群 ID
 * @returns {Promise<boolean>} 本机是否仍有该群 replica 目录
 */
export async function userHasLocalGroupReplica(username, groupId) {
	const { access } = await import('node:fs/promises')
	try {
		await access(groupDir(username, groupId))
		return true
	}
	catch {
		return false
	}
}

/**
 * DAG 事件流 JSONL 路径。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组或会话 ID
 * @returns {string} `events.jsonl` 绝对路径
 */
export function eventsPath(username, groupId) {
	return join(groupDir(username, groupId), 'events.jsonl')
}

/**
 * DAG 拓扑序缓存（与 `events.jsonl` 并列）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组 ID
 * @returns {string} `events.order.json` 绝对路径
 */
export function eventsOrderCachePath(username, groupId) {
	return join(groupDir(username, groupId), 'events.order.json')
}

/**
 * HLC 超 skew 消息类事件的隔离区（§0；不入主 DAG 直至可重放）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组 ID
 * @returns {string} `quarantine.jsonl` 绝对路径
 */
export function quarantinePath(username, groupId) {
	return join(groupDir(username, groupId), 'quarantine.jsonl')
}

/**
 * 本地物化快照路径（§19 `snapshot.json`；非全网权威，仅加速恢复）。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组或会话 ID
 * @returns {string} `snapshot.json` 绝对路径
 */
export function snapshotPath(username, groupId) {
	return join(groupDir(username, groupId), 'snapshot.json')
}

/**
 * 频道消息派生日志 JSONL 路径。
 * @param {string} username 本地账户名
 * @param {string} groupId 群组或会话 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 频道 JSONL 绝对路径
 */
export function messagesPath(username, groupId, channelId) {
	return join(groupDir(username, groupId), 'messages', `${channelId}.jsonl`)
}

/**
 * 频道按月冷归档 JSONL。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} yyyyMm `YYYY-MM`
 * @returns {string} 归档文件绝对路径
 */
export function channelArchivePath(username, groupId, channelId, yyyyMm) {
	return join(groupDir(username, groupId), 'archive', channelId, `${yyyyMm}.jsonl`)
}

/**
 * 群级归档 manifest（已归档月份与 eventId 索引）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {string} manifest 绝对路径
 */
export function archiveManifestPath(username, groupId) {
	return join(groupDir(username, groupId), 'archive_manifest.json')
}

/**
 * 群联邦同步水位（离线起始月、末帧 tipsHash）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {string} `syncState.json` 绝对路径
 */
export function groupSyncStatePath(username, groupId) {
	return join(groupDir(username, groupId), 'syncState.json')
}

/**
 * 频道归档目录。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 目录绝对路径
 */
export function channelArchiveDir(username, groupId, channelId) {
	return join(groupDir(username, groupId), 'archive', channelId)
}

/**
 * 消息 logContext sidecar：`groups/{groupId}/context_cache/{channelId}/{messageId}.json`
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} messageId 消息条目 ID
 * @returns {string} sidecar JSON 绝对路径
 */
export function sidecarPath(username, groupId, channelId, messageId) {
	return join(groupDir(username, groupId), 'context_cache', channelId, `${messageId}.json`)
}

/**
 * 群文件主密钥本地存储路径。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @returns {string} `file_master_keys.json` 绝对路径
 */
export function fileMasterKeysPath(username, groupId) {
	return join(groupDir(username, groupId), 'file_master_keys.json')
}

/**
 * 频道域密钥本地存储（K_ch 代际）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {string} `channel_keys.json` 绝对路径
 */
export function channelKeysPath(username, groupId) {
	return join(groupDir(username, groupId), 'channel_keys.json')
}

/**
 * 本机签名种子文件路径（32 字节二进制，不入 DAG）。
 * @param {string} username 本地账户名
 * @param {string} groupId 会话 / 群 ID
 * @returns {string} 种子文件绝对路径
 */
export function localSignerSeedPath(username, groupId) {
	return join(groupDir(username, groupId), 'local_signer_seed')
}

/**
 * 本地验收时间侧车（`receivedAt` 不进 DAG / Gossip，§6）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} `event_meta.json` 绝对路径
 */
export function eventMetaPath(username, groupId) {
	return join(groupDir(username, groupId), 'event_meta.json')
}

/**
 * 暂缓联邦中继队列（§2.1）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} `pending_relay.jsonl` 绝对路径
 */
export function pendingRelayPath(username, groupId) {
	return join(groupDir(username, groupId), 'pending_relay.jsonl')
}

/**
 * 实体数据目录：`{userDict}/entities/{entityHash}/`
 * @param {string} replicaUsername replica 磁盘所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} 实体目录绝对路径
 */
function userEntityDir(replicaUsername, entityHash) {
	return join(getUserDictionary(replicaUsername), 'entities', entityHash)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} profile.json 绝对路径
 */
function userEntityProfilePath(replicaUsername, entityHash) {
	return join(userEntityDir(replicaUsername, entityHash), 'profile.json')
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} avatars 目录绝对路径
 */
function userEntityAvatarsDir(replicaUsername, entityHash) {
	return join(userEntityDir(replicaUsername, entityHash), 'avatars')
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 作者 entityHash
 * @returns {string} stickers/packs 目录绝对路径
 */
function userEntityStickerPacksDir(replicaUsername, entityHash) {
	return join(userEntityDir(replicaUsername, entityHash), 'stickers', 'packs')
}

/**
 * 实体数据目录：`{userDict}/entities/{entityHash}/`
 * @param {string} replicaUsername replica 磁盘所有者（fount 登录名）
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} 实体目录绝对路径
 */
export function entityDir(replicaUsername, entityHash) {
	return userEntityDir(replicaUsername, entityHash)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @returns {string} entities 根目录
 */
export function userEntitiesRoot(replicaUsername) {
	return join(getUserDictionary(replicaUsername), 'entities')
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} profile.json 绝对路径
 */
export function entityProfilePath(replicaUsername, entityHash) {
	return userEntityProfilePath(replicaUsername, entityHash)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 128 位 entityHash
 * @returns {string} avatars 目录绝对路径
 */
export function entityAvatarsDir(replicaUsername, entityHash) {
	return userEntityAvatarsDir(replicaUsername, entityHash)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} entityHash 作者 entityHash
 * @returns {string} stickers/packs 目录绝对路径
 */
export function entityStickersPacksRoot(replicaUsername, entityHash) {
	return userEntityStickerPacksDir(replicaUsername, entityHash)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId 贴纸包 ID
 * @returns {string} 贴纸包目录绝对路径
 */
export function entityStickerPackDir(replicaUsername, authorEntityHash, packId) {
	return join(entityStickersPacksRoot(replicaUsername, authorEntityHash), packId)
}

/**
 * @param {string} replicaUsername replica 所有者
 * @param {string} authorEntityHash 作者 entityHash
 * @param {string} packId 贴纸包 ID
 * @returns {string} 贴纸媒体目录绝对路径
 */
export function entityStickerPackMediaDir(replicaUsername, authorEntityHash, packId) {
	return join(entityStickerPackDir(replicaUsername, authorEntityHash, packId), 'media')
}

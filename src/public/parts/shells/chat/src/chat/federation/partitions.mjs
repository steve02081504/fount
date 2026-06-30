/**
 * 联邦静态分区：频道分区 + 逻辑慢同步分区。
 */
import { createHash } from 'node:crypto'

/** 逻辑慢同步分区（gossip、mailbox、非活跃频道 DAG 等） */
export const LOGIC_SYNC_PARTITION = 'sync'

const DEFAULT_CHANNEL_PARTITIONS = 8

/**
 * @param {object} groupSettings 群设置
 * @returns {number} 频道哈希分区数（至少 2，至多 64）
 */
export function channelPartitionCount(groupSettings = {}) {
	const configuredPartitionCount = Number(groupSettings.federationPartitionCount)
	const partitionCount = Number.isFinite(configuredPartitionCount) && configuredPartitionCount >= 2
		? Math.floor(configuredPartitionCount)
		: DEFAULT_CHANNEL_PARTITIONS
	return Math.min(64, Math.max(2, partitionCount))
}

/**
 * @param {string} channelId 频道 ID
 * @param {number} count 分区数
 * @returns {string} 分区 id，如 `ch-03`
 */
export function channelPartitionFor(channelId, count) {
	const channelHash = createHash('sha256').update(String(channelId || 'default'), 'utf8').digest()
	const partitionIndex = channelHash.readUInt32BE(0) % count
	return `ch-${String(partitionIndex).padStart(2, '0')}`
}

/**
 * 本节点应加入的分区 id 列表。
 *
 * 当前折叠为「单一 sync 分区」：@trystero-p2p 的 strategy 把 offerPool / didInit / SharedPeerManager
 * 作为**进程级单例**跨所有 room 复用，同一进程加入第 2 个 room 时其 WebRTC 协商被破坏，导致两个 room
 * 全都发现不了对端（实测单 room 正常、双 room 即失效，与 appId/STUN/动作数无关）。故每群只用一个联邦 room，
 * 频道分流改在应用层（action 名 + 消息路由）完成。待 fork 支持多 room/进程后可恢复 ch-xx 分区。
 * @param {object} groupSettings 群设置
 * @param {string} [channelId] 频道 ID
 * @returns {string[]} 本节点应加入的分区 id 列表
 */
export function resolveNodePartitionIds(groupSettings = {}, channelId = null) {
	void groupSettings
	void channelId
	return [LOGIC_SYNC_PARTITION]
}

/**
 * @param {string} baseRoomId 基础房间名
 * @param {string} partitionId 分区 id
 * @returns {string} Trystero 房间名
 */
export function partitionRoomName(baseRoomId, partitionId) {
	const normalizedPartitionId = String(partitionId || LOGIC_SYNC_PARTITION).trim() || LOGIC_SYNC_PARTITION
	return `${baseRoomId}~${normalizedPartitionId}`
}

/**
 * @param {string} eventType DAG 事件类型
 * @param {string} [channelId] 频道
 * @param {object} groupSettings 群设置
 * @returns {string} 目标分区 id
 */
export function partitionForOutboundEvent(eventType, channelId, groupSettings = {}) {
	void eventType
	void channelId
	void groupSettings
	// 单一 sync 分区（见 resolveNodePartitionIds 的说明）：所有出站事件走同一个联邦 room。
	return LOGIC_SYNC_PARTITION
}

/**
 * @param {object} groupSettings 群设置
 * @param {string} [channelId] 频道
 * @param {string} targetPartition 目标分区
 * @returns {boolean} 本节点是否已加入目标分区
 */
export function nodeHasPartition(groupSettings, channelId, targetPartition) {
	return resolveNodePartitionIds(groupSettings, channelId).includes(targetPartition)
}

/**
 * @param {object} groupSettings 群设置
 * @param {string} [channelId] 频道
 * @returns {string} 跨分区桥接出站时使用的本机已连接分区（优先 sync）
 */
export function pickLocalRelayPartition(groupSettings, channelId) {
	const local = resolveNodePartitionIds(groupSettings, channelId)
	if (local.includes(LOGIC_SYNC_PARTITION)) return LOGIC_SYNC_PARTITION
	return local[0] || LOGIC_SYNC_PARTITION
}

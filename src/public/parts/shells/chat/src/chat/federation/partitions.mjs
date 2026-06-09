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
 * @param {object} groupSettings 群设置
 * @param {string} [channelId] 频道 ID
 * @returns {string[]} 本节点应加入的分区 id 列表（sync + 至少一个 ch-xx）
 */
export function resolveNodePartitionIds(groupSettings = {}, channelId = null) {
	const count = channelPartitionCount(groupSettings)
	const partitionIds = new Set([LOGIC_SYNC_PARTITION])
	partitionIds.add(channelPartitionFor(channelId || 'default', count))
	return [...partitionIds]
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
	const count = channelPartitionCount(groupSettings)
	const slowTypes = new Set([
		'gossip_request', 'part_invoke', 'discovery_announce',
	])
	if (slowTypes.has(eventType)) return LOGIC_SYNC_PARTITION
	if (eventType === 'message' || eventType === 'message_edit' || eventType === 'message_delete')
		return channelPartitionFor(channelId || 'default', count)
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

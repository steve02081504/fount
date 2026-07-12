/**
 * 【文件】federation/registry.mjs
 * 【职责】进程内联邦运行时注册表：Trystero 房间实例缓存、join 防重入、tip/gossip/频道历史等待槽，以及群→当前 join 用户的 owner 映射。
 * 【原理】分区槽按 username→groupId→partitionId 嵌套 Map 缓存；inflight 合并并发 join；rebindGeneration 使进行中的 join 作废。
 */
import {
	compositeKey,
	mapDelete,
	mapDeleteByPrefix,
	mapForEachUnder,
	mapGet,
	mapHas,
	mapSet,
} from 'npm:@steve02081504/fount-p2p/core/composite_key'
import { EVENT_ID_HEX } from 'npm:@steve02081504/fount-p2p/dag/index'

import { LOGIC_SYNC_PARTITION } from './partitions.mjs'

/**
 * DAG 事件 ID 的 64 位小写 hex 正则（自 `p2p/dag` 再导出）。
 */
export { EVENT_ID_HEX }

/** @type {Map<string, object | null>} */
export const federationPartitionSlots = new Map()

/** @type {Map<string, Promise<object | null>>} */
export const federationPartitionInflight = new Map()

/** @type {Map<string, number>} */
export const federationPartitionRebindGen = new Map()

/** 群 ID → 已 join 联邦房间的用户名 */
/** @type {Map<string, string>} */
export const groupFederationOwner = new Map()

/** @type {Map<string, { collected: Set<string>, remoteSummaries: object[], timer: ReturnType<typeof setTimeout>, resolve: () => void }>} */
export const pendingTipExchanges = new Map()

/** @type {Map<string, Array<{ resolve: () => void, timer: ReturnType<typeof setTimeout> }>>} gossip 等待：前缀 username:groupId: → suffix */
export const pendingGossipRequests = new Map()

/** @type {Map<string, { resolve: (rows: object[]) => void, timer: ReturnType<typeof setTimeout> }>} */
export const pendingChannelHistory = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} [partitionId] 分区 id
 * @returns {object | null | undefined} 已 join 的分区槽
 */
export function getFederationPartitionSlot(username, groupId, partitionId = LOGIC_SYNC_PARTITION) {
	return mapGet(federationPartitionSlots, username, groupId, partitionId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @param {object | null} slot 槽
 * @returns {void}
 */
export function setFederationPartitionSlot(username, groupId, partitionId, slot) {
	mapSet(federationPartitionSlots, username, groupId, partitionId, slot)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {boolean} 是否已有缓存槽
 */
export function hasFederationPartitionSlot(username, groupId, partitionId) {
	return mapHas(federationPartitionSlots, username, groupId, partitionId)
}

/**
 * 替换/失效前对被丢弃的 slot 做底层 teardown：leave Trystero 房间并清空 roster。
 * 没有它，旧 slot 的 Trystero 房间会成为持有 peer 连接的孤儿。
 * @param {object | null | undefined} slot 联邦槽
 * @returns {void}
 */
function teardownFederationSlot(slot) {
	if (slot && typeof slot.leave === 'function')
		void Promise.resolve(slot.leave()).catch(error => console.error('federation: slot teardown failed', error))
}

/**
 * 从注册表移除分区槽但不 leave 底层 Trystero room（join-before-leave 替换时用）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {object | null | undefined} 被移除的 slot
 */
export function detachFederationPartitionSlot(username, groupId, partitionId) {
	const slot = mapGet(federationPartitionSlots, username, groupId, partitionId)
	mapDelete(federationPartitionSlots, username, groupId, partitionId)
	return slot
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {void}
 */
export function deleteFederationPartitionSlot(username, groupId, partitionId) {
	teardownFederationSlot(mapGet(federationPartitionSlots, username, groupId, partitionId))
	mapDelete(federationPartitionSlots, username, groupId, partitionId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {Promise<object | null> | undefined} 进行中的 join Promise
 */
export function getFederationPartitionInflight(username, groupId, partitionId) {
	return mapGet(federationPartitionInflight, username, groupId, partitionId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @param {Promise<object | null>} task join 任务
 * @returns {void}
 */
export function setFederationPartitionInflight(username, groupId, partitionId, task) {
	mapSet(federationPartitionInflight, username, groupId, partitionId, task)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {void}
 */
export function deleteFederationPartitionInflight(username, groupId, partitionId) {
	mapDelete(federationPartitionInflight, username, groupId, partitionId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {number} 当前 rebind 代数
 */
export function getFederationPartitionRebindGen(username, groupId, partitionId) {
	return mapGet(federationPartitionRebindGen, username, groupId, partitionId) || 0
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {void}
 */
export function bumpFederationPartitionRebindGen(username, groupId, partitionId) {
	mapSet(
		federationPartitionRebindGen,
		username,
		groupId,
		partitionId,
		getFederationPartitionRebindGen(username, groupId, partitionId) + 1,
	)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function invalidateFederationPartitionsForGroup(username, groupId) {
	// 收集所有相关分区（slot / inflight / 已有 gen），逐个 bump（递增）rebind gen，而非删除回 0：
	// 任何在本次 invalidate 之前读取 genAtJoin、之后才完成的 inflight join 都会因 gen 不匹配而放弃回填 slot，
	// 杜绝删群/换房后孤儿 werift 持连泄漏。（若删 gen 回 0，则 genAtJoin===0 的进行中 join 会再次匹配而回填。）
	const partitionIds = new Set()
	mapForEachUnder(federationPartitionSlots, username, groupId, tail => partitionIds.add(tail[0]))
	mapForEachUnder(federationPartitionInflight, username, groupId, tail => partitionIds.add(tail[0]))
	mapForEachUnder(federationPartitionRebindGen, username, groupId, tail => partitionIds.add(tail[0]))
	mapForEachUnder(federationPartitionSlots, username, groupId, (_tail, slot) => teardownFederationSlot(slot))
	mapDeleteByPrefix(federationPartitionSlots, username, groupId)
	mapDeleteByPrefix(federationPartitionInflight, username, groupId)
	for (const partitionId of partitionIds)
		bumpFederationPartitionRebindGen(username, groupId, partitionId)
	groupFederationOwner.delete(groupId)
}

/**
 * @param {string} username 用户
 * @returns {void}
 */
export function invalidateAllFederationPartitionsForUser(username) {
	mapForEachUnder(federationPartitionSlots, username, (_tail, slot) => teardownFederationSlot(slot))
	mapDeleteByPrefix(federationPartitionSlots, username)
	mapDeleteByPrefix(federationPartitionInflight, username)
	mapDeleteByPrefix(federationPartitionRebindGen, username)
	for (const [groupId, owner] of groupFederationOwner)
		if (owner === username) groupFederationOwner.delete(groupId)
}

/**
 * @param {string} username 用户
 * @param {(groupId: string, partitionId: string, slot: object | null) => void} fn 回调
 * @returns {void}
 */
export function forEachFederationPartitionSlot(username, fn) {
	mapForEachUnder(federationPartitionSlots, username, ([groupId, partitionId], slot) => {
		fn(groupId, partitionId, slot)
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {(slot: object) => void} fn 回调
 * @returns {void}
 */
export function forEachFederationRoomSlotInGroup(username, groupId, fn) {
	forEachFederationPartitionSlot(username, (gid, partitionId, slot) => {
		if (gid !== groupId || !slot) return
		fn(slot, partitionId)
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ collected: Set<string>, timer: ReturnType<typeof setTimeout>, resolve: () => void } | undefined} tip 交换等待项
 */
export function getPendingTipExchange(username, groupId) {
	return mapGet(pendingTipExchanges, username, groupId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ collected: Set<string>, timer: ReturnType<typeof setTimeout>, resolve: () => void }} entry 等待项
 * @returns {void}
 */
export function setPendingTipExchange(username, groupId, entry) {
	mapSet(pendingTipExchanges, username, groupId, entry)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function deletePendingTipExchange(username, groupId) {
	mapDelete(pendingTipExchanges, username, groupId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} gossip 多 waiter 表前缀键
 */
export function gossipWaitPrefix(username, groupId) {
	return compositeKey(username, groupId)
}

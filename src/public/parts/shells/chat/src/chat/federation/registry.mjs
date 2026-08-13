/**
 * 【文件】federation/registry.mjs
 * 【职责】进程内联邦运行时注册表：P2P 房间实例缓存、join 防重入、tip/gossip/频道历史等待槽，以及群→当前 join 用户的 owner 映射。
 * 【原理】分区槽按 username→groupId→partitionId 嵌套 Map 缓存；inflight 合并并发 join；rebindGeneration 使进行中的 join 作废。
 */
import { compositeKey } from 'npm:@steve02081504/fount-p2p/core/composite_key'
import { EVENT_ID_HEX } from 'npm:@steve02081504/fount-p2p/dag/index'

import { LOGIC_SYNC_PARTITION } from './partitions.mjs'

const KEY_SEP = '\0'

/**
 * @param {Map<string, unknown>} map 扁平复合键表
 * @param {string[]} prefixParts 前缀段
 * @param {(tail: string[], value: unknown, key: string) => void} fn 回调
 * @returns {void}
 */
function forEachUnder(map, prefixParts, fn) {
	const prefix = compositeKey(...prefixParts) + KEY_SEP
	for (const [key, value] of map)
		if (key.startsWith(prefix)) fn(key.slice(prefix.length).split(KEY_SEP), value, key)
}

/**
 * @param {Map<string, unknown>} map 扁平复合键表
 * @param {string[]} prefixParts 前缀段
 * @returns {void}
 */
function deleteUnder(map, prefixParts) {
	const prefix = compositeKey(...prefixParts) + KEY_SEP
	for (const key of [...map.keys()])
		if (key.startsWith(prefix)) map.delete(key)
}

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
	return federationPartitionSlots.get(compositeKey(username, groupId, partitionId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @param {object | null} slot 槽
 * @returns {void}
 */
export function setFederationPartitionSlot(username, groupId, partitionId, slot) {
	federationPartitionSlots.set(compositeKey(username, groupId, partitionId), slot)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {boolean} 是否已有缓存槽
 */
export function hasFederationPartitionSlot(username, groupId, partitionId) {
	return federationPartitionSlots.has(compositeKey(username, groupId, partitionId))
}

/**
 * 替换/失效前对被丢弃的 slot 做底层 teardown：leave 联邦房间并清空 roster。
 * 没有它，旧 slot 的联邦房间会成为持有 peer 连接的孤儿。
 * @param {object | null | undefined} slot 联邦槽
 * @returns {void}
 */
function teardownFederationSlot(slot) {
	if (slot?.leave)
		void Promise.resolve(slot.leave()).catch(error => console.error('federation: slot teardown failed', error))
}

/**
 * 从注册表移除分区槽但不 leave 底层 federation room（join-before-leave 替换时用）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {object | null | undefined} 被移除的 slot
 */
export function detachFederationPartitionSlot(username, groupId, partitionId) {
	const key = compositeKey(username, groupId, partitionId)
	const slot = federationPartitionSlots.get(key)
	federationPartitionSlots.delete(key)
	return slot
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {void}
 */
export function deleteFederationPartitionSlot(username, groupId, partitionId) {
	const key = compositeKey(username, groupId, partitionId)
	teardownFederationSlot(federationPartitionSlots.get(key))
	federationPartitionSlots.delete(key)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {Promise<object | null> | undefined} 进行中的 join Promise
 */
export function getFederationPartitionInflight(username, groupId, partitionId) {
	return federationPartitionInflight.get(compositeKey(username, groupId, partitionId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @param {Promise<object | null>} task join 任务
 * @returns {void}
 */
export function setFederationPartitionInflight(username, groupId, partitionId, task) {
	federationPartitionInflight.set(compositeKey(username, groupId, partitionId), task)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {void}
 */
export function deleteFederationPartitionInflight(username, groupId, partitionId) {
	federationPartitionInflight.delete(compositeKey(username, groupId, partitionId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {number} 当前 rebind 代数
 */
export function getFederationPartitionRebindGen(username, groupId, partitionId) {
	return federationPartitionRebindGen.get(compositeKey(username, groupId, partitionId)) || 0
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {string} partitionId 分区 id
 * @returns {void}
 */
export function bumpFederationPartitionRebindGen(username, groupId, partitionId) {
	federationPartitionRebindGen.set(
		compositeKey(username, groupId, partitionId),
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
	forEachUnder(federationPartitionSlots, [username, groupId], tail => partitionIds.add(tail[0]))
	forEachUnder(federationPartitionInflight, [username, groupId], tail => partitionIds.add(tail[0]))
	forEachUnder(federationPartitionRebindGen, [username, groupId], tail => partitionIds.add(tail[0]))
	forEachUnder(federationPartitionSlots, [username, groupId], (_tail, slot) => teardownFederationSlot(slot))
	deleteUnder(federationPartitionSlots, [username, groupId])
	deleteUnder(federationPartitionInflight, [username, groupId])
	for (const partitionId of partitionIds)
		bumpFederationPartitionRebindGen(username, groupId, partitionId)
	groupFederationOwner.delete(groupId)
}

/**
 * @param {string} username 用户
 * @returns {void}
 */
export function invalidateAllFederationPartitionsForUser(username) {
	forEachUnder(federationPartitionSlots, [username], (_tail, slot) => teardownFederationSlot(slot))
	deleteUnder(federationPartitionSlots, [username])
	deleteUnder(federationPartitionInflight, [username])
	deleteUnder(federationPartitionRebindGen, [username])
	for (const [groupId, owner] of groupFederationOwner)
		if (owner === username) groupFederationOwner.delete(groupId)
}

/**
 * @param {string} username 用户
 * @param {(groupId: string, partitionId: string, slot: object | null) => void} fn 回调
 * @returns {void}
 */
export function forEachFederationPartitionSlot(username, fn) {
	forEachUnder(federationPartitionSlots, [username], ([groupId, partitionId], slot) => {
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
	return pendingTipExchanges.get(compositeKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {{ collected: Set<string>, timer: ReturnType<typeof setTimeout>, resolve: () => void }} entry 等待项
 * @returns {void}
 */
export function setPendingTipExchange(username, groupId, entry) {
	pendingTipExchanges.set(compositeKey(username, groupId), entry)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function deletePendingTipExchange(username, groupId) {
	pendingTipExchanges.delete(compositeKey(username, groupId))
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} gossip 多 waiter 表前缀键
 */
export function gossipWaitPrefix(username, groupId) {
	return compositeKey(username, groupId)
}

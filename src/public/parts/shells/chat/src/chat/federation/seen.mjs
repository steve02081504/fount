/**
 * 【文件】federation/seen.mjs
 * 【职责】进程级 DAG 事件 id LRU 去重（§4 防环），避免同一联邦事件在 P2P 网状中继中被重复 ingest。
 * 【原理】按 username\0groupId 分桶，order+set 实现 LRU，默认 cap 50k；桶数超限时淘汰最旧桶。房间重连时 warmSeenFromLocalEvents 用本地 events.jsonl 预热，与入站 hasSeen 检查配合。
 * 【数据结构】seenByKey: Map→{ order: string[], set: Set<eventId> }；eventId 为 64 位 hex。
 * 【关联】room.mjs dag_event 入站、index 出站前可选检查；scripts/p2p/hexIds isHex64。
 */

import { isHex64 } from '../../../../../../../scripts/p2p/hexIds.mjs'

import { EVENT_ID_HEX, getPendingTipExchange } from './registry.mjs'

const DEFAULT_CAP = 50_000
const MAX_BUCKET_COUNT = 2_000
const BUCKET_EVICT_COUNT = 500

/** @type {Map<string, { order: string[], set: Set<string> }>} */
const seenByKey = new Map()

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {number} [cap] LRU 容量
 * @returns {{ order: string[], set: Set<string> }} 桶
 */
function bucketFor(username, groupId, cap = DEFAULT_CAP) {
	const key = `${username}\0${groupId}`
	let bucket = seenByKey.get(key)
	if (!bucket) {
		bucket = { order: [], set: new Set() }
		seenByKey.set(key, bucket)
	}
	while (bucket.order.length > cap) {
		const old = bucket.order.shift()
		if (old) bucket.set.delete(old)
	}
	if (seenByKey.size > MAX_BUCKET_COUNT) {
		const drop = [...seenByKey.keys()].slice(0, BUCKET_EVICT_COUNT)
		for (const key of drop) seenByKey.delete(key)
	}
	return bucket
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} eventId 64 位十六进制事件 id
 * @returns {boolean} 近期已见过
 */
export function hasSeenFederationEvent(username, groupId, eventId) {
	if (!isHex64(eventId)) return false
	return bucketFor(username, groupId).set.has(eventId)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {string} eventId 事件 id
 * @returns {void}
 */
export function markSeenFederationEvent(username, groupId, eventId) {
	if (!isHex64(eventId)) return
	const bucket = bucketFor(username, groupId)
	if (bucket.set.has(eventId)) return
	bucket.set.add(eventId)
	bucket.order.push(eventId)
}

/**
 * 从本地 events.jsonl 预热 LRU（房间重连时调用）。
 * @param {string} username 用户
 * @param {string} groupId 群
 * @param {object[]} events 本地事件行
 * @returns {void}
 */
export function warmSeenFromLocalEvents(username, groupId, events) {
	const bucket = bucketFor(username, groupId)
	for (const event of events) {
		if (!isHex64(event?.id) || bucket.set.has(event.id)) continue
		bucket.set.add(event.id)
		bucket.order.push(event.id)
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {unknown} tips 对端 tips 数组
 * @returns {void}
 */
export function ingestRemoteTipsForExchange(username, groupId, tips) {
	const pending = getPendingTipExchange(username, groupId)
	if (!pending || !Array.isArray(tips)) return
	for (const tipId of tips)
		if (EVENT_ID_HEX.test(String(tipId)))
			pending.collected.add(String(tipId).trim().toLowerCase())
}

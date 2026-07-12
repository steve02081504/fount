/**
 * 群级消息限速内存桶（按 entityKey 滑动窗口）。
 */
import { createLruMap } from '../../../../../../../scripts/memo.mjs'
import {
	messageRateEntityKey,
	resolveMessageRateLimits,
} from 'npm:@steve02081504/fount-p2p/federation/message_rate_limit'

const BUCKETS_BY_GROUP_MAX = 1024

/** @type {Map<string, { bucket: Map<string, number[]>, rebuilt: boolean }>} */
const groupsByKey = createLruMap(BUCKETS_BY_GROUP_MAX)

/**
 * @param {Map<string, number[]>} bucket 实体 → 时间戳
 * @param {number} windowMs 窗口毫秒
 * @param {number} [now] 当前时间
 * @returns {void} 无返回值
 */
function pruneBucket(bucket, windowMs, now = Date.now()) {
	for (const [entityKey, times] of bucket.entries()) {
		const pruned = times.filter(t => now - t <= windowMs)
		if (!pruned.length) bucket.delete(entityKey)
		else if (pruned.length !== times.length) bucket.set(entityKey, pruned)
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {{ bucket: Map<string, number[]>, rebuilt: boolean }} 群限速条目（LRU 逐出时 rebuilt 一并丢弃）
 */
function groupEntry(username, groupId) {
	const key = `${username}:${groupId}`
	let entry = groupsByKey.get(key)
	entry ??= { bucket: new Map(), rebuilt: false }
	groupsByKey.touch(key, entry)
	return entry
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} event message 事件
 * @param {object} [groupSettings] 群设置（决定滑动窗口）
 * @returns {void}
 */
export function recordMessageRate(username, groupId, event, groupSettings) {
	if (event?.type !== 'message') return
	const entityKey = messageRateEntityKey(event)
	if (!entityKey) return
	const { windowMs } = resolveMessageRateLimits(groupSettings)
	const wall = Number(event.hlc?.wall ?? Date.now())
	const { bucket } = groupEntry(username, groupId)
	bucket.set(entityKey, [...bucket.get(entityKey) || [], wall])
	pruneBucket(bucket, windowMs, wall)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {object} event 待校验 message
 * @returns {{ ok: boolean, reason?: string, excessRatio?: number }} 是否允许发送
 */
export function checkMessageRateLimitMemory(username, groupId, state, event) {
	if (event?.type !== 'message') return { ok: true }
	const entityKey = messageRateEntityKey(event)
	if (!entityKey) return { ok: false, reason: 'missing sender' }

	const { perMin, windowMs } = resolveMessageRateLimits(state.groupSettings)
	const now = Date.now()
	const { bucket } = groupEntry(username, groupId)
	const times = (bucket.get(entityKey) || []).filter(t => now - t <= windowMs)
	if (!times.length) bucket.delete(entityKey)
	else bucket.set(entityKey, times)
	if (times.length >= perMin) {
		const excess = times.length - perMin + 1
		return {
			ok: false,
			reason: 'message rate limit exceeded',
			excessRatio: Math.min(1, excess / Math.max(1, perMin)),
		}
	}
	pruneBucket(bucket, windowMs, now)
	return { ok: true }
}

/**
 * 冷启动：从 DAG 尾部重建桶（每群至多一次，直至 LRU 逐出）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object[]} tail 最近事件行
 * @param {object} [groupSettings] 群设置
 * @returns {void}
 */
export function rebuildRateLimitBucketFromTail(username, groupId, tail, groupSettings) {
	const entry = groupEntry(username, groupId)
	entry.bucket.clear()
	const { windowMs } = resolveMessageRateLimits(groupSettings)
	const now = Date.now()
	for (const row of tail) {
		if (row?.type !== 'message') continue
		const entityKey = messageRateEntityKey(row)
		if (!entityKey) continue
		const wall = Number(row.hlc?.wall ?? now)
		if (now - wall > windowMs) continue
		entry.bucket.set(entityKey, [...entry.bucket.get(entityKey) || [], wall])
	}
	pruneBucket(entry.bucket, windowMs, now)
	entry.rebuilt = true
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {boolean} 本进程是否已从 DAG 尾部重建过该群桶
 */
export function isRateLimitBucketRebuilt(username, groupId) {
	return groupEntry(username, groupId).rebuilt
}

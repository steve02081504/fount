/**
 * 群级消息限速内存桶（按 entityKey 滑动窗口）。
 */
import { createLruMap } from '../../../../../../../scripts/memo.mjs'
import {
	messageRateEntityKey,
	resolveMessageRateLimits,
} from '../../../../../../../scripts/p2p/message_rate_limit.mjs'

const BUCKETS_BY_GROUP_MAX = 1024
const DEFAULT_WINDOW_MS = 60_000

/** @type {Map<string, Map<string, number[]>>} */
const bucketsByGroup = createLruMap(BUCKETS_BY_GROUP_MAX)

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
 * @returns {Map<string, number[]>} 实体 → 时间戳列表
 */
function groupBucket(username, groupId) {
	const key = `${username}:${groupId}`
	let bucket = bucketsByGroup.get(key)
	bucket ??= new Map()
	bucketsByGroup.touch(key, bucket)
	return bucket
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} event message 事件
 * @returns {void}
 */
export function recordMessageRate(username, groupId, event) {
	if (event?.type !== 'message') return
	const entityKey = messageRateEntityKey(event)
	if (!entityKey) return
	const wall = Number(event.hlc?.wall ?? Date.now())
	const bucket = groupBucket(username, groupId)
	const times = bucket.get(entityKey) || []
	times.push(wall)
	bucket.set(entityKey, times)
	pruneBucket(bucket, DEFAULT_WINDOW_MS, wall)
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
	const bucket = groupBucket(username, groupId)
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
 * 冷启动：从 DAG 尾部重建桶（仅调用一次/群）。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object[]} tail 最近事件行
 * @returns {void}
 */
export function rebuildRateLimitBucketFromTail(username, groupId, tail) {
	const bucket = groupBucket(username, groupId)
	bucket.clear()
	for (const row of tail)
		if (row?.type === 'message') recordMessageRate(username, groupId, row)

}

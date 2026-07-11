/**
 * 60 秒令牌桶限速（fed_chunk / fed_emoji 等 want-data 线共用）。
 */

import { createLruMap } from './utils/lru.mjs'

const WINDOW_MS = 60_000
const BUCKET_MAP_MAX = 5000

/** @type {ReturnType<typeof createLruMap<string, { tokens: number, bytes: number, lastRefill: number }>>} */
const buckets = createLruMap(BUCKET_MAP_MAX)

/**
 * @param {string} bucketKey 房间或资源键
 * @param {{ maxCount: number, byteCount?: number, maxBytesPerWindow?: number }} limits 限额
 * @returns {boolean} 是否允许本次消费
 */
export function consumeWireRateBucket(bucketKey, limits) {
	const byteCount = Math.max(0, Number(limits.byteCount) || 0)
	const maxBytes = Number(limits.maxBytesPerWindow) || 0
	const maxCount = limits.maxCount
	const now = Date.now()
	let bucket = buckets.get(bucketKey)
	if (!bucket) {
		bucket = {
			tokens: maxCount,
			bytes: maxBytes > 0 ? maxBytes : Number.POSITIVE_INFINITY,
			lastRefill: now,
		}
		buckets.touch(bucketKey, bucket)
	}
	else buckets.touch(bucketKey, bucket)
	const elapsed = now - bucket.lastRefill
	if (elapsed > 0) {
		const rate = maxCount / WINDOW_MS
		bucket.tokens = Math.min(maxCount, bucket.tokens + elapsed * rate)
		if (maxBytes > 0) {
			const byteRate = maxBytes / WINDOW_MS
			bucket.bytes = Math.min(maxBytes, bucket.bytes + elapsed * byteRate)
		}
		bucket.lastRefill = now
	}
	if (bucket.tokens < 1) return false
	if (maxBytes > 0 && bucket.bytes < byteCount) return false
	bucket.tokens -= 1
	if (maxBytes > 0) bucket.bytes -= byteCount
	buckets.touch(bucketKey, bucket)
	return true
}

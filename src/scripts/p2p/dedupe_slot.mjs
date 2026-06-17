import { createLruMap } from './utils/memo.mjs'

/**
 * TTL 去重槽：partition bridge、gossip 等共用。
 */

/**
 * @param {{ maxSize?: number, ttlMs?: number }} [options] 容量与 TTL
 * @returns {(key: string) => boolean} 首次占用返回 true
 */
export function createDedupeSlot(options = {}) {
	const maxSize = Number(options.maxSize) || 2000
	const ttlMs = Number(options.ttlMs) || 30_000
	/** @type {Map<string, number>} */
	const seen = createLruMap(maxSize)

	/**
	 * @param {string} key 去重键
	 * @returns {boolean} 首次占用返回 true
	 */
	const take = key => {
		const now = Date.now()
		const seenAt = seen.get(key)
		if (seenAt !== undefined) {
			if (now - seenAt < ttlMs) return false
			seen.delete(key)
		}
		seen.touch(key, now)
		return true
	}

	return take
}

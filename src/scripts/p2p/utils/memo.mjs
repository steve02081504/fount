/**
 * 通用 Promise 去重与 LRU Map。
 */

/**
 * @template K, V
 * @param {number} max 最大条目
 * @returns {Map<K, V>} 带 touch 方法的 LRU Map
 */
export function createLruMap(max) {
	/** @type {Map<K, V>} */
	const map = new Map()
	/**
	 * @param {K} key 键
	 * @param {V} value 值
	 */
	const touch = (key, value) => {
		if (map.has(key)) map.delete(key)
		map.set(key, value)
		while (map.size > max) {
			const oldest = map.keys().next().value
			map.delete(oldest)
		}
	}
	return Object.assign(map, { touch })
}

/**
 * @template T
 * @param {(rawKey: string) => string} keyFn 缓存键
 * @param {(key: string) => Promise<T>} fn 异步工厂
 * @returns {(rawKey: string) => Promise<T>} 去重包装
 */
export function dedupeAsync(keyFn, fn) {
	/** @type {Map<string, Promise<T>>} */
	const inflight = new Map()
	return async rawKey => {
		const key = keyFn(rawKey)
		if (inflight.has(key)) return inflight.get(key)
		const promise = fn(key).finally(() => inflight.delete(key))
		inflight.set(key, promise)
		return promise
	}
}

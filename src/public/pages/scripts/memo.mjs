/**
 * 浏览器侧 Promise 去重与 LRU（与 `src/scripts/memo.mjs` 同 API）。
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
 * @param {(key: string) => Promise<T>} fn 实际加载
 * @param {{ ttlMs?: number, max?: number }} [options] TTL 与容量
 * @returns {(rawKey: string) => Promise<T>} 去重后的加载函数
 */
export function memoizePromise(keyFn, fn, options = {}) {
	const ttlMs = options.ttlMs ?? 0
	const max = options.max ?? 512
	const cache = createLruMap(max)
	/** @type {Map<string, Promise<T>>} */
	const inflight = new Map()

	/**
	 * @param {string} rawKey 原始键
	 * @returns {Promise<T>} 缓存或加载结果
	 */
	const load = async rawKey => {
		const key = keyFn(rawKey)
		const hit = cache.get(key)
		if (hit && (!ttlMs || Date.now() - hit.at < ttlMs))
			return hit.value

		const pending = inflight.get(key)
		if (pending) return pending

		const promise = fn(key).then(value => {
			cache.touch(key, { value, at: Date.now() })
			inflight.delete(key)
			return value
		}, error => {
			inflight.delete(key)
			throw error
		})
		inflight.set(key, promise)
		return promise
	}

	/**
	 * @param {string} rawKey 原始键
	 * @returns {void}
	 */
	load.deleteKey = rawKey => {
		const key = keyFn(rawKey)
		cache.delete(key)
		inflight.delete(key)
	}

	/**
	 * @param {(key: string) => boolean} predicate 匹配缓存键
	 * @returns {void}
	 */
	load.deleteMatching = predicate => {
		for (const key of new Set([...cache.keys(), ...inflight.keys()]))
			if (predicate(key)) {
				cache.delete(key)
				inflight.delete(key)
			}
	}

	return load
}

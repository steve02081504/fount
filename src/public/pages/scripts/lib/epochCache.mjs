/**
 * 带 epoch 作废的异步缓存：bump 后进行中的旧请求仍返回值，但不回填 cache。
 */

/**
 * @template T
 * @typedef {{
 *   bump: () => void,
 *   get: (key: string, load: () => Promise<T>) => Promise<T>,
 *   peek: (key: string) => T | undefined,
 * }} EpochCache
 */

/**
 * 创建 epoch 缓存。
 * @template T
 * @returns {EpochCache<T>} 缓存
 */
export function createEpochCache() {
	let epoch = 0
	/** @type {Map<string, T>} */
	const cache = new Map()
	/** @type {Map<string, Promise<T>>} */
	const inflight = new Map()
	return {
		/**
		 * 作废 cache / inflight（进行中的 load 仍会 resolve，但不写入 cache）。
		 * @returns {void}
		 */
		bump() {
			epoch++
			cache.clear()
			inflight.clear()
		},
		/**
		 * 取缓存或触发 load；始终返回本次 load 结果（即使因 epoch 未入 cache）。
		 * @param {string} key 缓存键
		 * @param {() => Promise<T>} load 加载函数
		 * @returns {Promise<T>} 条目
		 */
		async get(key, load) {
			const cached = cache.get(key)
			if (cached !== undefined) return cached
			const existing = inflight.get(key)
			if (existing) return existing

			const captured = epoch
			const request = (async () => {
				const value = await load()
				if (captured === epoch) cache.set(key, value)
				return value
			})()
			inflight.set(key, request)
			try {
				return await request
			}
			finally {
				if (inflight.get(key) === request) inflight.delete(key)
			}
		},
		/**
		 * 只读窥探 cache（不含 inflight）。
		 * @param {string} key 缓存键
		 * @returns {T | undefined} 命中值
		 */
		peek(key) {
			return cache.get(key)
		},
	}
}

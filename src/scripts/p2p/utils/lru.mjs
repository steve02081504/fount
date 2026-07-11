/**
 * @template K, V
 * @param {number} max 最大条目
 * @returns {Map<K, V> & { touch: (key: K, value: V) => void }} 带 touch 方法的 LRU Map
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

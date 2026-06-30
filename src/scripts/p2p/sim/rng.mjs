/**
 * 确定性 PRNG（mulberry32）。
 */

/**
 * @param {number} seed 种子
 * @returns {() => number} [0, 1) 均匀随机函数
 */
export function createRng(seed) {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6D2B79F5) >>> 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * @param {() => number} rng 随机源
 * @param {number} min 下界（含）
 * @param {number} max 上界（不含）
 * @returns {number} [min, max) 整数
 */
export function randInt(rng, min, max) {
	return Math.floor(rng() * (max - min)) + min
}

/**
 * @param {() => number} rng 随机源
 * @param {readonly T[]} items 候选数组
 * @returns {T} 随机元素
 * @template T
 */
export function pickOne(rng, items) {
	return items[Math.floor(rng() * items.length)]
}

/**
 * @param {() => number} rng 随机源
 * @param {readonly T[]} items 候选数组
 * @param {number} k 抽取个数
 * @returns {T[]} 不重复随机子集
 * @template T
 */
export function pickMany(rng, items, k) {
	const copy = [...items]
	const out = []
	while (copy.length && out.length < k) {
		const i = Math.floor(rng() * copy.length)
		out.push(copy.splice(i, 1)[0])
	}
	return out
}

/**
 * @param {number} index 序号
 * @returns {string} 64 hex 伪 nodeHash
 */
export function fakeNodeHash(index) {
	return index.toString(16).padStart(64, '0')
}

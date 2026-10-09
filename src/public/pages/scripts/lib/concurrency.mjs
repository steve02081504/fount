/**
 * 并发执行工具：以固定上限跑一批异步任务。
 * @module concurrency
 */

/**
 * 以固定并发上限执行任务：同一时刻最多 `limit` 个 worker 在跑，全部完成后 resolve。
 * 用于「一次要发很多请求，但目标服务有速率限制/不该被瞬间打满」的批处理（如 preloadrunner 的预取）。
 * 任一 worker 抛错时立即停止启动新任务，并把该错误抛给调用方（已在跑的任务不会被中断）。
 * @template T, R
 * @param {Iterable<T>} items - 待处理项
 * @param {number} limit - 并发上限；小于 1 或非有限数时按 1 处理
 * @param {(item: T, index: number) => Promise<R>} worker - 处理函数
 * @returns {Promise<R[]>} 与 items 顺序一致的结果数组
 */
export async function runWithConcurrency(items, limit, worker) {
	const list = [...items]
	const size = Math.max(1, Math.floor(Number(limit)) || 1)
	/** @type {R[]} */
	const results = new Array(list.length)
	let nextIndex = 0

	/**
	 * 不断领取下一个下标并处理，直到取完或被错误中止。
	 * @returns {Promise<void>} 无返回值
	 */
	const runSlot = async () => {
		while (nextIndex < list.length) {
			const index = nextIndex++
			try {
				results[index] = await worker(list[index], index)
			}
			catch (error) {
				nextIndex = list.length
				throw error
			}
		}
	}

	await Promise.all(Array.from({ length: Math.min(size, list.length) }, runSlot))
	return results
}

/**
 * 按分组分别限流：每个分组各自最多 `limit` 个任务在跑，不同分组之间互不排队，组内保持传入顺序。
 * 用于「一批请求分散在多个 hostname 上」的批处理（如预取）：统一限流会让所有 host 互相排队，
 * 按 host 限流则既不会把单个对端打爆，也不会让 A 站的慢请求挡住 B 站。
 * @template T, R
 * @param {Iterable<T>} items - 待处理项
 * @param {object} options - 参数对象
 * @param {number} options.limit - 每个分组的并发上限（小于 1 时按 1 处理）
 * @param {(item: T) => string} options.keyOf - 分组键（如 `new URL(item.url).hostname`）
 * @param {(item: T, index: number) => Promise<R>} options.worker - 处理函数
 * @returns {Promise<void>} 所有分组的任务完成后 resolve；任一 worker 抛错时以该错误 reject
 */
export async function runWithConcurrencyPerGroup(items, { limit, keyOf, worker }) {
	/** @type {Map<string, { item: T, index: number }[]>} */
	const groups = new Map()
	let index = 0
	for (const item of items) {
		const key = keyOf(item)
		const group = groups.get(key)
		if (group) group.push({ item, index: index++ })
		else groups.set(key, [{ item, index: index++ }])
	}

	await Promise.all([...groups.values()].map(group =>
		runWithConcurrency(group, limit, entry => worker(entry.item, entry.index))))
}

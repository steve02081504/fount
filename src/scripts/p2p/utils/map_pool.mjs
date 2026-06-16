/**
 * 有限并发 map（进程内，无外部依赖）。
 * @template T, R
 * @param {T[]} items 待处理项
 * @param {(item: T, index: number) => Promise<R>} fn 异步映射
 * @param {number} concurrency 并发上限
 * @returns {Promise<R[]>} 与 items 同序的结果
 */
export async function mapPool(items, fn, concurrency) {
	if (!items.length) return []
	const limit = Math.max(1, Math.min(concurrency, items.length))
	/** @type {R[]} */
	const results = new Array(items.length)
	let nextIndex = 0

	/** @returns {Promise<void>} */
	const worker = async () => {
		for (;;) {
			const i = nextIndex++
			if (i >= items.length) return
			results[i] = await fn(items[i], i)
		}
	}

	await Promise.all(Array.from({ length: limit }, () => worker()))
	return results
}

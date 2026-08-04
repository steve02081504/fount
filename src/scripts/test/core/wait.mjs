/**
 * 通用硬轮询：谓词为真则返回，超时抛错；谓词可为异步。
 */

/**
 * @param {number} ms 毫秒
 * @returns {Promise<void>}
 */
export function sleep(ms) {
	return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * 硬轮询：单位为毫秒；超时抛 `waitUntil timeout`。
 * @param {() => unknown | Promise<unknown>} predicate 条件（可 async；假值则继续）
 * @param {number} [timeoutMs=10000] 超时毫秒
 * @param {number} [intervalMs=100] 间隔毫秒
 * @returns {Promise<void>}
 */
export async function waitUntil(predicate, timeoutMs = 10000, intervalMs = 100) {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await predicate()) return
		await sleep(intervalMs)
	}
	throw new Error('waitUntil timeout')
}

/**
 * 为一个 promise 添加超时功能。
 * @param {number} ms - 超时时间，单位为毫秒。
 * @param {Promise<any>} promise - 要包装的 promise。
 * @returns {Promise<any>}一个新的 promise，如果在给定时间内原始 promise 未解决或拒绝，则会因超时错误而拒绝。原 promise 的拒绝在超时后不再上报，可安全注入会异步失败的查询。
 */
export function with_timeout(ms, promise) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms)
		promise.then(resolve).catch(reject).finally(() => clearTimeout(timer))
	})
}

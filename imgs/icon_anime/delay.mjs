/**
 * 可中止的延时（不依赖 `node:timers`）。
 * @param {number} milliseconds 毫秒
 * @param {{ signal?: AbortSignal }} [options] 中止信号
 * @returns {Promise<void>} 到期兑现；中止则拒绝 `AbortError`
 */
export function delay(milliseconds, { signal } = {}) {
	return new Promise((resolve, reject) => {
		/**
		 * @returns {Error} 中止错误
		 */
		const abortError = () => signal?.reason instanceof Error
			? signal.reason
			: Object.assign(new Error('Aborted'), { name: 'AbortError' })
		if (signal?.aborted) {
			reject(abortError())
			return
		}
		/**
		 * 到期前中止：清定时器并拒绝。
		 * @returns {void}
		 */
		const onAbort = () => {
			clearTimeout(timer)
			reject(abortError())
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort)
			resolve()
		}, milliseconds)
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

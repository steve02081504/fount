/**
 * 可中止的延时（不依赖 `node:timers`）。
 * @param {number} milliseconds 毫秒
 * @param {unknown} [_value] 占位（对齐 `timers/promises` 第二参）
 * @param {{ signal?: AbortSignal }} [options] 中止信号
 * @returns {Promise<void>} 到期兑现；中止则拒绝 `AbortError`
 */
export function delay(milliseconds, _value, { signal } = {}) {
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
		const timer = setTimeout(resolve, milliseconds)
		signal?.addEventListener('abort', () => {
			clearTimeout(timer)
			reject(abortError())
		}, { once: true })
	})
}

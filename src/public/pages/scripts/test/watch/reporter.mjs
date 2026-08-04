/**
 * watch 控制台去重上报：每个 reporter 自带 Set，前缀固定。
 */

/**
 * @typedef {{ report: (key: string, ...parts: unknown[]) => void }} WatchReporter
 */

/**
 * 创建带前缀的去重 reporter。
 * @param {string} prefix 控制台前缀（如 `[test:a11y]`）
 * @returns {WatchReporter} reporter
 */
export function createReporter(prefix) {
	/** @type {Set<string>} */
	const seen = new Set()
	return {
		/**
		 * 首次见到 key 时 `console.error(prefix, ...parts)`。
		 * @param {string} key 去重键
		 * @param {...unknown} parts 日志参数
		 * @returns {void}
		 */
		report(key, ...parts) {
			if (seen.has(key)) return
			seen.add(key)
			console.error(prefix, ...parts)
		},
	}
}

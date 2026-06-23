/**
 * 频道增量刷新防抖计时器（轻量模块，导航路径可同步取消而无需 import messages 图）。
 */

/** @type {ReturnType<typeof setTimeout> | null} */
let channelIncrementalDebounceTimer = null

/** @returns {void} */
export function cancelScheduledChannelRefresh() {
	if (channelIncrementalDebounceTimer) {
		clearTimeout(channelIncrementalDebounceTimer)
		channelIncrementalDebounceTimer = null
	}
}

/**
 * @param {() => void | Promise<void>} fn 到期回调
 * @param {number} delayMs 防抖毫秒
 * @param {{ immediate?: boolean }} [opts] `immediate` 为 true 时立即执行
 * @returns {void}
 */
export function scheduleDebouncedChannelRefresh(fn, delayMs, { immediate = false } = {}) {
	if (immediate) {
		cancelScheduledChannelRefresh()
		void fn()
		return
	}
	if (channelIncrementalDebounceTimer) clearTimeout(channelIncrementalDebounceTimer)
	channelIncrementalDebounceTimer = setTimeout(() => {
		channelIncrementalDebounceTimer = null
		void fn()
	}, delayMs)
}

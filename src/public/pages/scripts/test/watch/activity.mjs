/**
 * 页面活动静默门控：DOM 变更 / 指针 / 键盘活动后暂停会重建 DOM 的检查（locale 轮换），
 * 避免与测试动作抢跑把目标节点 detach。静默窗口结束再唤醒 loop。
 */
import { wake } from './loop.mjs'

/** 静默窗口：最后一次活动后多久才允许再次轮换（毫秒）。 */
export const QUIET_MS = 1200

let timer = 0

/**
 * 标记一次页面活动，并约好在静默窗口结束后唤醒 loop。
 * @returns {void}
 */
export function markActivity() {
	clearTimeout(timer)
	timer = setTimeout(() => {
		timer = 0
		wake()
	}, QUIET_MS + 25)
}

/**
 * 当前是否处于静默（无待唤醒的恢复计时）。
 * @returns {boolean} 静默则为 true
 */
export function isQuiet() {
	return !timer
}

/**
 * 清空活动门控（selftest 隔离）。
 * @returns {void}
 */
export function resetActivity() {
	clearTimeout(timer)
	timer = 0
}

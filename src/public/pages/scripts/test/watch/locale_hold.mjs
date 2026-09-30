/**
 * 语种轮换 hold 引用计数（与 DOM / i18n 解耦，便于 selftest）。
 *
 * hold 必须是一个**异步屏障**：仅加计数不够——若 `holdLocale()` 调用时 `locale.mjs` 的
 * `run()` 已越过 `isLocaleHeld()` 检查并在 `await` 中，轮换仍会执行（整页重建 → 抢走测试的点击）。
 * 因此这里额外跟踪“进行中的语种切换”promise，`holdLocale()` 会等它结束；切换方在真正
 * 改语言前用 `canSwitchLocale()` 再确认一次 hold 状态，hold 已被接住就放弃本轮。
 */
import { wake } from './loop.mjs'

/** @type {number} */
let localeHold = 0
/** 进行中的语种切换 promise（无则为 null）。 */
let switchInFlight = null

/**
 * 暂停语种轮换：加计数并等待已开始的切换结束（异步屏障）。
 * @returns {Promise<void>} 进行中的切换结束（无则为立即完成）
 */
export async function holdLocale() {
	localeHold++
	await switchInFlight
}

/**
 * 恢复语种轮换（引用计数）；归零时唤醒可能已停住的 loop。
 * 无配对释放（计数降到负）视为 bug，抛错以便暴露测试接线错误。
 * @returns {void}
 */
export function releaseLocale() {
	localeHold--
	if (localeHold < 0) {
		localeHold = 0
		throw new Error('releaseLocale without a matching holdLocale')
	}
	if (localeHold === 0) wake()
}

/**
 * 当前是否仍 hold。
 * @returns {boolean} hold 中则为 true
 */
export function isLocaleHeld() {
	return localeHold > 0
}

/**
 * 登记一次开始中的语种切换（返回收尾函数）。切换期间 `holdLocale()` 会等待。
 * @returns {() => void} 结束回调
 */
export function beginLocaleSwitch() {
	let end
	switchInFlight = new Promise(resolve => { end = resolve })
	return () => {
		switchInFlight = null
		end()
	}
}

/**
 * 切换方在真正改语言前的最终确认：此刻是否仍允许切换（未被 hold 接住）。
 * @returns {boolean} 允许切换则为 true
 */
export function canSwitchLocale() {
	return localeHold === 0
}

/**
 * 清空 hold（selftest 隔离）。
 * @returns {void}
 */
export function resetLocaleHold() {
	localeHold = 0
	switchInFlight = null
}

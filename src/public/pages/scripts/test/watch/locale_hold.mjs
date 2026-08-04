/**
 * 语种轮换 hold 引用计数（与 DOM / i18n 解耦，便于 selftest）。
 */
import { wake } from './loop.mjs'

/** @type {number} */
let localeHold = 0

/**
 * 暂停语种轮换（引用计数）。
 * @returns {void}
 */
export function holdLocale() {
	localeHold++
}

/**
 * 恢复语种轮换（引用计数）；归零时唤醒可能已停住的 loop。
 * @returns {void}
 */
export function releaseLocale() {
	localeHold--
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
 * 清空 hold（selftest 隔离）。
 * @returns {void}
 */
export function resetLocaleHold() {
	localeHold = 0
}

/**
 * 任务栏进度
 */
import process from 'node:process'

import supportsAnsi from 'npm:supports-ansi'

/**
 * 检查是否支持任务栏进度。
 * @returns {boolean} 是否支持任务栏进度。
 */
const enabled = () => Boolean(supportsAnsi && process.stdout.writable)

/**
 * 清除任务栏进度。
 */
export function ClearTaskbarProgress() {
	if (enabled()) process.stdout.write('\x1b]9;4;0\x07')
}

/**
 * 将任务栏进度设为错误状态（红色）。
 * @returns {void}
 */
export function SetTaskbarProgressError() {
	if (enabled()) process.stdout.write('\x1b]9;4;2;100\x07')
}

/**
 * 设置任务栏进度百分比
 * @param {number|undefined} percent - 0..100, undefined 表示不确定状态（转圈）
 * @returns {void}
 */
export function SetTaskbarProgress(percent) {
	if (!enabled()) return
	if (percent === undefined) return void process.stdout.write('\x1b]9;4;3\x07')
	const p = Math.max(0, Math.min(100, Math.floor(Number(percent))))
	process.stdout.write(`\x1b]9;4;1;${p}\x07`)
}

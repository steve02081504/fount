/**
 * 任务栏进度（ANSI 序列 \x1b]9;4;...\x1b\\，Cargo 1.85+ / Windows Terminal 等支持）
 * 使用 npm:supports-ansi 检测终端支持，且 process.stdout 可写时输出。
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
	if (enabled()) process.stdout.write('\x1b]9;4;0;0\x1b\\')
}

/**
 * 将任务栏进度设为错误状态（红色）。
 * @returns {void}
 */
export function SetTaskbarProgressError() {
	if (enabled()) process.stdout.write('\x1b]9;4;2;100\x1b\\')
}

/**
 * 设置任务栏进度百分比
 * @param {number|undefined} percent - 0..100, undefined 表示不确定状态（转圈）
 * @returns {void}
 */
export function SetTaskbarProgress(percent) {
	if (!enabled()) return
	if (percent === undefined) return void process.stdout.write('\x1b]9;4;3;0\x1b\\')
	const p = Math.max(0, Math.min(100, Math.floor(Number(percent))))
	process.stdout.write(`\x1b]9;4;1;${p}\x1b\\`)
}

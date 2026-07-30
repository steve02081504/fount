/**
 * fount test 终端任务栏进度（OSC 9;4）。
 */
import { ClearTaskbarProgress, SetTaskbarProgress, SetTaskbarProgressError } from '../../taskbar_progress.mjs'

/**
 * 开始测试进度指示。
 */
export function beginTestProgress() {
	SetTaskbarProgress(0)
}

/**
 * 按 report 槽位完成数同步进度百分比。
 * @param {{ slots: { state: string }[] }} reportWriter 运行报告写入器
 */
export function syncTestProgress(reportWriter) {
	const total = reportWriter.slots.length
	if (!total) return
	const completed = reportWriter.slots.filter(slot => slot.state === 'done').length
	SetTaskbarProgress(Math.floor((completed / total) * 100))
}

/**
 * 测试结束：成功清除进度，失败标红。
 * @param {number} exitCode 进程退出码
 */
export function finishTestProgress(exitCode) {
	if (exitCode === 0) ClearTaskbarProgress()
	else SetTaskbarProgressError()
}

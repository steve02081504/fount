/**
 * 测试进程标记。display/CLI 不能 import env.mjs（编排器堆快照），但须在导入 i18n 前设置。
 *
 * 同时全局接住 fatal 事件（uncaughtException / unhandledRejection / error）：fount 本体在
 * server.mjs 也这样做。仅打日志并置 exitCode，进程不退出——`test watch` 期间一次瞬时错误
 * （如 locale JSON 写一半）不该整场崩溃；一次性运行仍因 exitCode=1 返回非零而不掩盖失败。
 */
import process from 'node:process'

process.env.FOUNT_TEST ??= '1'

for (const event of ['uncaughtException', 'unhandledRejection', 'error'])
	process.on(event, error => {
		console.error(`[test ${event}]`, error)
		process.exitCode ||= 1
	})

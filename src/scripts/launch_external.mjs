import { spawn } from 'node:child_process'
import process from 'node:process'

/**
 * 用户主动触发的、与 fount 主进程分离的外部程序启动（编辑器、终端等）。
 * AGENTS.md 中「禁止子进程」规则的唯一定义例外入口。
 *
 * POSIX 用 `detached` 开新 session 即可；Windows 上 `spawn` 的 `detached` 只改
 * console、不改父 PID，子进程仍是启动方进程树的一员——一旦启动方被整树终止
 * （`taskkill /T`、终端按 Job Object 清理），它会被连带带走。故 Windows 经
 * `cmd /c start` 起一个孤儿进程：中间 `cmd` 立即退出后父链断开，树杀追不到它。
 * 其余选项（`cwd` / `windowsHide` 等）直接转发给 `spawn`；后台进程（如测试内核）传
 * `windowsHide: true`（CREATE_NO_WINDOW）可避免新建的 console 被 Windows Terminal
 * 当作新 tab 显示；终端/编辑器等用户可见启动保持默认。
 * @param {object} options 启动选项
 * @param {string} options.command 程序路径
 * @param {string[]} [options.args] 参数
 * @param {string} [options.cwd] 工作目录
 * @param {Record<string, string>} [options.env] 追加环境变量
 * @param {boolean} [options.windowsHide] Windows 上隐藏新建的 console
 * @returns {Promise<void>}
 */
export function launchDetachedProgram(options = {}) {
	const { command, args = [], ...spawnOptions } = options
	const mergedEnv = spawnOptions.env ? { ...process.env, ...spawnOptions.env } : process.env
	const spawnOnce = process.platform === 'win32'
		? () => spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', '/b', command, ...args], {
			...spawnOptions,
			env: mergedEnv,
			detached: true,
			stdio: 'ignore',
		})
		: () => spawn(command, args, { ...spawnOptions, env: mergedEnv, detached: true, stdio: 'ignore' })
	return new Promise((resolve, reject) => {
		const processRef = spawnOnce()
		processRef.once('spawn', () => {
			processRef.unref()
			resolve()
		})
		processRef.once('error', reject)
	})
}

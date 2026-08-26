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
 * @param {{ command: string, args?: string[], cwd?: string, env?: Record<string, string> }} options 启动选项
 * @returns {Promise<void>}
 */
export function launchDetachedProgram({ command, args = [], cwd, env }) {
	const mergedEnv = env ? { ...process.env, ...env } : process.env
	const spawnOnce = process.platform === 'win32'
		? () => spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '', '/b', command, ...args], {
			detached: true,
			stdio: 'ignore',
			cwd,
			env: mergedEnv,
		})
		: () => spawn(command, args, { detached: true, stdio: 'ignore', cwd, env: mergedEnv })
	return new Promise((resolve, reject) => {
		const processRef = spawnOnce()
		processRef.once('spawn', () => {
			processRef.unref()
			resolve()
		})
		processRef.once('error', reject)
	})
}

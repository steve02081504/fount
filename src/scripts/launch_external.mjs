import { spawn } from 'node:child_process'
import process from 'node:process'

/**
 * 用户主动触发的、与 fount 主进程分离的外部程序启动（编辑器、终端等）。
 * AGENTS.md 中「禁止子进程」规则的唯一定义例外入口。
 * @param {{ command: string, args?: string[], cwd?: string, env?: Record<string, string> }} options - 启动选项。
 * @returns {Promise<void>}
 */
export function launchDetachedProgram({ command, args = [], cwd, env }) {
	return new Promise((resolve, reject) => {
		const processRef = spawn(command, args, {
			detached: true,
			stdio: 'ignore',
			cwd,
			env: env ? { ...process.env, ...env } : process.env,
		})
		processRef.once('spawn', () => {
			processRef.unref()
			resolve()
		})
		processRef.once('error', reject)
	})
}

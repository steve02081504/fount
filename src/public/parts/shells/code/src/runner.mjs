/**
 * code shell 执行入口：`!` shell 模式命令执行。
 */
import { createTargetExecutor } from '../../../plugins/file-operations/src/target.mjs'

/**
 * 规范化 shell 执行结果。
 * @typedef {object} shellResult_t
 * @property {number|undefined} code 退出码
 * @property {number|undefined} exitCode 退出码（别名）
 * @property {string|undefined} stdout 标准输出
 * @property {string|undefined} stderr 标准错误
 * @property {string|undefined} stdall 合并输出
 * @property {number|undefined} elapsedMs 耗时（毫秒）
 */

/**
 * 在目标机器的工作目录执行 shell 命令。
 * 未指定工作区时经 execJs 取目标机器家目录兜底（避免以服务器进程 cwd 如 system32 执行）。
 * 默认不设超时（`timeoutMs: null`），但仍返回耗时；`env` 仅本机生效（远程无法注入环境变量）。
 * @param {object} options - 执行参数。
 * @param {string} options.username - 用户名。
 * @param {string} [options.machine='0'] - 目标机器标识（"0" = 本机）。
 * @param {string} [options.workdir] - 工作目录。
 * @param {string} [options.shell] - shell 类型（缺省按目标机器默认）。
 * @param {string} options.command - 命令。
 * @param {Record<string, string>} [options.env] - 追加环境变量（仅本机与 `process.env` 合并）。
 * @param {number|null} [options.timeoutMs] - 超时毫秒（缺省 null = 不限时）。
 * @param {(stream: 'stdout'|'stderr', data: string) => void} [options.onOutput] - 逐块输出回调（本机直连；远程经回调通道，需 `shells/code` 实现 `RemoteCallBack`）。
 * @returns {Promise<shellResult_t>} 执行结果（错误时捕获为 { code: -1, stdall }）。
 */
export async function runShellCommand({ username, machine = '0', workdir, shell, command, env, timeoutMs = null, onOutput }) {
	const probeExecutor = createTargetExecutor(username, { machine })
	const resolvedWorkdir = workdir || await probeExecutor.execJs(async () => (await import('node:os')).homedir())
	const executor = createTargetExecutor(username, { machine, workdir: resolvedWorkdir })
	const localEnv = String(machine) === '0' && env ? env : undefined
	const start = Date.now()
	try {
		const result = await executor.execShell(shell || null, command, {
			timeoutMs,
			env: localEnv,
			onOutput,
			callbackPartpath: typeof onOutput === 'function' ? 'shells/code' : undefined,
		})
		if (result instanceof Error)
			return { code: -1, stdall: String(result.stack || result.message || result), elapsedMs: Date.now() - start }
		return { ...result, elapsedMs: result?.elapsedMs ?? Date.now() - start }
	}
	catch (err) {
		return { code: -1, stdall: String(err?.stack || err), elapsedMs: Date.now() - start }
	}
}

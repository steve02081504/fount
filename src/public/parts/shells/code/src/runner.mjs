/**
 * code shell 执行入口：`!` shell 模式命令执行。
 */
import { availableShells, createTargetExecutor, machineDefaultShell } from '../../../plugins/file-operations/src/target.mjs'

/**
 * 转发执行器模块的 shell 能力查询（可用 shell 列表 / 本机默认 shell）。
 */
export { availableShells, machineDefaultShell }

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
 * 用户主动执行的命令不设超时（`timeoutMs: null`），但仍返回耗时。
 * @param {object} options - 执行参数。
 * @param {string} options.username - 用户名。
 * @param {string} [options.machine='0'] - 目标机器标识（"0" = 本机）。
 * @param {string} [options.workdir] - 工作目录。
 * @param {string} [options.shell] - shell 类型（缺省按目标机器默认）。
 * @param {string} options.command - 命令。
 * @returns {Promise<shellResult_t>} 执行结果（错误时捕获为 { code: -1, stdall }）。
 */
export async function runShellCommand({ username, machine = '0', workdir, shell, command }) {
	const probeExecutor = createTargetExecutor(username, { machine })
	const resolvedWorkdir = workdir || await probeExecutor.execJs(async () => (await import('node:os')).homedir())
	const executor = createTargetExecutor(username, { machine, workdir: resolvedWorkdir })
	const start = Date.now()
	try {
		const result = await executor.execShell(shell || null, command, { timeoutMs: null })
		if (result instanceof Error)
			return { code: -1, stdall: String(result.stack || result.message || result), elapsedMs: Date.now() - start }
		return { ...result, elapsedMs: result?.elapsedMs ?? Date.now() - start }
	}
	catch (err) {
		return { code: -1, stdall: String(err?.stack || err), elapsedMs: Date.now() - start }
	}
}

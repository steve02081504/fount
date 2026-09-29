/**
 * code-execution 的 shell 可用性解析。
 *
 * 提示词与 ReplyHandler 注册都必须基于**目标机器**的真实可用 shell，且二者用同一份判断，
 * 否则模型会被指引去用一个没有处理器的标签（如未装 PowerShell 7 时的 `<run-pwsh>`），
 * 标签便原样穿透到消息里被 shell 直接渲染。
 *
 * `pwsh` 特例：底层 `@steve02081504/exec` 的 `pwsh_exec` 在没有 `pwsh` 时会回退到
 * `powershell.exe`，所以只要目标机器有 `powershell`，`pwsh` 就应视为可用（反之不成立）。
 * @typedef {import('../../../../../src/decl/chatLog.ts').chatReplyRequest_t} chatReplyRequest_t
 */
import { shell_exec_map } from 'npm:@steve02081504/exec'

import { availableShells, machineDefaultShell, resolveTarget } from '../file-operations/src/target.mjs'

/** shell 优先级（默认 shell 选取用）。 */
const SHELL_PRIORITY = ['pwsh', 'powershell', 'bash', 'sh']

/**
 * 判断某个 shell 名在给定可用集合下是否可用（含 `pwsh` → `powershell` 别名回退）。
 * @param {string} shellName - shell 名。
 * @param {string[]} shells - 目标机器可用的 shell 名列表。
 * @returns {boolean} 是否可用。
 */
export function isShellUsable(shellName, shells) {
	// pwsh_exec 在无 pwsh 时回退到 powershell.exe；powershell_exec 不回退到 pwsh。
	return Boolean(shells?.includes(shellName) || shellName === 'pwsh' && shells?.includes('powershell'))
}

/**
 * 解析目标机器可用的 shell 名列表（本机读运行时探测，远程读分机上报）。
 * @param {chatReplyRequest_t} [args] - GetReply 请求（读 `username` 与 `workdir`）。
 * @param {{machine?: string|number, workdir?: string}} [attrs] - 标签显式参数（覆盖请求目标）。
 * @returns {Promise<string[]>} 可用 shell 名列表。
 */
export async function resolveAvailableShells(args, attrs) {
	const target = resolveTarget(args, attrs)
	return await availableShells(args?.username, target.machine)
}

/**
 * 在可用集合中选一个默认 shell（优先目标机器自身默认，其次按固定优先级）。
 * @param {string[]} shells - 可用 shell 名列表（已含别名可用项）。
 * @param {string} [preferred] - 目标机器默认 shell。
 * @returns {string} 选中的 shell 名；集合为空时回退 `sh`。
 */
export function pickDefaultShell(shells, preferred) {
	if (preferred && shells.includes(preferred)) return preferred
	for (const name of SHELL_PRIORITY)
		if (shells.includes(name)) return name
	return shells[0] ?? 'sh'
}

/**
 * 解析目标机器默认 shell 名（本机运行时探测，远程读分机上报）。
 * @param {chatReplyRequest_t} [args] - GetReply 请求。
 * @returns {Promise<string>} 默认 shell 名；信息不可得时为空串。
 */
export async function resolveDefaultShell(args) {
	const target = resolveTarget(args)
	return await machineDefaultShell(args?.username, target.machine)
}

/**
 * 列出所有已注册执行器的 shell 名（供处理器注册与提示词生成共用）。
 * @returns {string[]} shell 名列表。
 */
export function registeredShellNames() {
	return Object.keys(shell_exec_map)
}

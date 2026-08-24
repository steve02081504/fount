/**
 * 模组检查租约客户端（hub HTTP）与 deno `--preload` 注入。
 */
import { fileURLToPath } from 'node:url'

import { getTestHubBaseUrl } from '../base_url.mjs'

/**
 * 子进程未发 ready 就退出。
 */
export class ModuleCheckMissedReadyError extends Error {
	/**
	 * @param {string} [label] suite / 文件
	 * @param {unknown} [result] 子进程已返回的结果（若有）
	 */
	constructor(label = '', result) {
		super(label ? `module-check missed ready: ${label}` : 'module-check missed ready')
		this.name = 'ModuleCheckMissedReadyError'
		this.label = label
		this.result = result
	}
}

/** 子进程 `--preload`：模块图物化后、用户代码前发 ready。 */
export const MODULE_CHECK_PRELOAD = fileURLToPath(new URL('../../module_check_ready.mjs', import.meta.url))

/** 单次 ready 尝试的超时（毫秒）。 */
const MODULE_CHECK_READY_ATTEMPT_TIMEOUT_MS = 10_000
/** ready 握手总窗口（毫秒）：覆盖内核瞬时繁忙导致的偶发延迟，避免子进程被误杀。 */
const MODULE_CHECK_READY_TOTAL_TIMEOUT_MS = 120_000
/** 尝试间隔（毫秒）。 */
const MODULE_CHECK_READY_RETRY_DELAY_MS = 2_000

/**
 * 给 deno run/test/bench 插入 `--preload`（有 ticket 时）。
 * 已有 `--preload` / `--import` 时仍插入模组检查 preload。
 * @param {string[]} command `deno …` 或已去掉可执行文件的 argv
 * @param {string | null | undefined} ticket 租约
 * @returns {string[]} 可能插入 preload 后的命令
 */
export function withDenoModuleCheckPreload(command, ticket) {
	if (!ticket || !command.length) return command
	const start = command[0] === 'deno' ? 1 : 0
	const sub = command[start]
	if (sub !== 'run' && sub !== 'test' && sub !== 'bench') return command
	const out = [...command]
	out.splice(start + 1, 0, `--preload=${MODULE_CHECK_PRELOAD}`)
	return out
}

/**
 * 子进程 ticket 环境：无 ticket 时显式清空以覆盖父进程。
 * @param {string | null | undefined} ticket 租约
 * @returns {{ FOUNT_TEST_MODULE_CHECK_TICKET: string }} env 片段
 */
export function moduleCheckTicketEnv(ticket) {
	return { FOUNT_TEST_MODULE_CHECK_TICKET: ticket || '' }
}

/**
 * 向内核申请模组检查租约；无 hub 则跳过。
 * @returns {Promise<string | null>} ticket
 */
export async function acquireModuleCheckTicket() {
	const base = getTestHubBaseUrl()
	if (!base) return null
	const res = await fetch(`${base}/module-check/acquire`, { method: 'POST' })
	if (!res.ok) return null
	const data = await res.json()
	return data?.ticket || null
}

/**
 * 通知内核模组检查完成。
 * @param {string} ticket 租约
 * @returns {Promise<void>}
 */
export async function signalModuleCheckReady(ticket) {
	const base = getTestHubBaseUrl()
	if (!base || !ticket) return
	const deadline = Date.now() + MODULE_CHECK_READY_TOTAL_TIMEOUT_MS
	for (;;) 
		try {
			const res = await fetch(`${base}/module-check/ready`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ticket }),
				signal: AbortSignal.timeout(MODULE_CHECK_READY_ATTEMPT_TIMEOUT_MS),
			})
			if (!res.ok)
				throw new Error(`module-check ready failed: ${res.status}`)
			return
		}
		catch (error) {
			// 仅重试瞬时故障（超时/网络），硬错误（非 2xx）立即抛出。
			const transient = error?.name === 'TimeoutError' || error instanceof TypeError
			if (!transient || Date.now() >= deadline) throw error
			await new Promise(resolve => { setTimeout(resolve, MODULE_CHECK_READY_RETRY_DELAY_MS) })
		}
	
}

/**
 * 子进程未 ready 就结束时释放闸；已 ready 则为 no-op。
 * @param {string} ticket 租约
 * @returns {Promise<boolean>} 仍持有（missed ready）
 */
export async function abandonModuleCheckTicket(ticket) {
	const base = getTestHubBaseUrl()
	if (!base || !ticket) return false
	try {
		const res = await fetch(`${base}/module-check/abandon`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ticket }),
		})
		if (!res.ok) return false
		const data = await res.json()
		return data?.missed === true
	}
	catch {
		return false
	}
}

/**
 * 父进程 spawn 前占闸；子进程 env.mjs / preload 会 ready。未 ready 就结束则报错。
 * spawn 失败只释放闸，不伪装成 missed-ready。
 * @template T
 * @param {(ticket: string | null) => Promise<T>} run 持有 ticket 的工作
 * @returns {Promise<T>} 结果
 */
export async function withModuleCheckTicket(run) {
	const ticket = await acquireModuleCheckTicket()
	try {
		const result = await run(ticket)
		if (ticket) {
			const missed = await abandonModuleCheckTicket(ticket)
			if (missed) throw new ModuleCheckMissedReadyError('', result)
		}
		return result
	}
	catch (error) {
		if (ticket && !(error instanceof ModuleCheckMissedReadyError))
			await abandonModuleCheckTicket(ticket)
		throw error
	}
}

/**
 * 模组检查租约客户端（hub HTTP）。
 */
import { getTestHubBaseUrl } from '../base_url.mjs'

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
	await fetch(`${base}/module-check/ready`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ticket }),
	}).catch(() => {})
}

/**
 * 父进程 spawn 前占闸；子进程 env.mjs 会 ready。若子进程未 ready 则父进程补发。
 * @template T
 * @param {(ticket: string | null) => Promise<T>} run 持有 ticket 的工作
 * @returns {Promise<T>} 结果
 */
export async function withModuleCheckTicket(run) {
	const ticket = await acquireModuleCheckTicket()
	try {
		return await run(ticket)
	}
	finally {
		if (ticket) await signalModuleCheckReady(ticket)
	}
}

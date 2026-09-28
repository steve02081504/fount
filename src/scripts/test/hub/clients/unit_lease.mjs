/**
 * 全局单元租约客户端（hub HTTP）：serial.mjs 文件 worker 逐文件申请机器余量。
 *
 * 无 hub（手动单跑）时 acquire 返回 null，调用方直接执行——退化为本地并行。
 * 租约由资源闸门在 suite 结束时统一回收，故 worker 崩溃漏掉 release 也不会永久占额。
 */
import { getTestHubBaseUrl } from '../base_url.mjs'

/**
 * 申请一个单元租约；无 hub 或非 2xx 返回 null。
 * @param {string} suiteKey suite 键（manifest:suite）
 * @returns {Promise<object | null>} 租约；不可用时 null
 */
export async function acquireUnitLease(suiteKey) {
	const base = getTestHubBaseUrl()
	if (!base) return null
	const res = await fetch(`${base}/unit/acquire`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ suiteKey }),
	})
	if (!res.ok) return null
	const data = await res.json()
	return data?.lease || null
}

/**
 * 释放单元租约；任何失败均吞掉，绝不抛出。
 * @param {object | null | undefined} lease 租约
 * @returns {Promise<void>}
 */
export async function releaseUnitLease(lease) {
	const base = getTestHubBaseUrl()
	if (!base || !lease) return
	try {
		await fetch(`${base}/unit/release`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ lease }),
		})
	}
	catch { /* 释放失败忽略，服务端断开时回收 */ }
}

/**
 * 持有一个单元租约运行；无租约时直接运行。
 * @template T
 * @param {string} suiteKey suite 键
 * @param {() => Promise<T>} run 持锁工作
 * @returns {Promise<T>} 结果
 */
export async function withUnitLease(suiteKey, run) {
	const lease = await acquireUnitLease(suiteKey)
	if (!lease) return run()
	try {
		return await run()
	}
	finally {
		await releaseUnitLease(lease)
	}
}

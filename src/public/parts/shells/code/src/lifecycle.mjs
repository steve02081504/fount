/**
 * code shell 生成生命周期：完成后通知用户 + 所有任务生成完毕后关闭选定 fount 主机。
 */
import process from 'node:process'

import { geti18nForUser } from '../../../../../scripts/i18n/index.mjs'
import { notifyUser } from '../../../../../server/web_server/notify/notify.mjs'
import { executeCodeOnSubfount } from '../../subfounts/src/api.mjs'

/** @type {Map<string, number>} 用户名 → 进行中的 code 生成数（跨页面并发）。 */
const activeGenerations = new Map()
/** @type {Map<string, string>} 用户名 → 待关闭的主机 id（"0" = 本机）。 */
const pendingShutdowns = new Map()

/**
 * 标记一次 code 生成开始（send / regen 送出前调用）。
 * @param {string} username - 用户名。
 * @returns {void}
 */
export function beginCodeGeneration(username) {
	activeGenerations.set(username, (activeGenerations.get(username) || 0) + 1)
}

/**
 * 标记一次 code 生成结束（done / aborted / error 后调用）；全部结束且已预定关机的执行关机。
 * @param {string} username - 用户名。
 * @returns {void}
 */
export function finishCodeGeneration(username) {
	const remaining = (activeGenerations.get(username) || 0) - 1
	if (remaining > 0) {
		activeGenerations.set(username, remaining)
		return
	}
	activeGenerations.delete(username)
	const machine = pendingShutdowns.get(username)
	if (machine == null) return
	pendingShutdowns.delete(username)
	void shutdownHost(username, machine)
}

/**
 * 读取待关机状态（前端 pill 展示用）。
 * @param {string} username - 用户名。
 * @returns {{machine: string|null, active: number}} 状态。
 */
export function getShutdownState(username) {
	return { machine: pendingShutdowns.get(username) ?? null, active: activeGenerations.get(username) || 0 }
}

/**
 * 预定：所有 code 生成结束后关闭指定主机。
 * @param {string} username - 用户名。
 * @param {string} machine - 主机 id（"0" = 本机）。
 * @returns {{machine: string|null, active: number}} 写入后的状态。
 */
export function scheduleShutdown(username, machine) {
	pendingShutdowns.set(username, String(machine))
	return getShutdownState(username)
}

/**
 * 取消预定的关机。
 * @param {string} username - 用户名。
 * @returns {{machine: string|null, active: number}} 取消后的状态。
 */
export function cancelShutdown(username) {
	pendingShutdowns.delete(username)
	return getShutdownState(username)
}

/**
 * 关闭目标主机：本机直接退出进程（走 on_shutdown 优雅收尾），subfount 上请求其进程退出。
 * @param {string} username - 用户名。
 * @param {string} machine - 主机 id（"0" = 本机）。
 * @returns {Promise<void>}
 */
async function shutdownHost(username, machine) {
	if (String(machine) === '0') {
		// 稍等片刻让 done 响应 / 通知先送达浏览器，再走优雅关机
		setTimeout(() => process.exit(0), 500)
		return
	}
	try {
		await executeCodeOnSubfount(username, Number(machine), 'const mod = await import(\'node:process\')\nconst proc = mod.default ?? mod\nsetTimeout(() => proc.exit(0), 200)\nreturn \'ok\'')
	}
	catch { /* 分机不可达或已退出：无需处理 */ }
}

/**
 * 角色回复完成后向用户推送通知（浏览器在线经 /ws/notify，离线回退 Web Push）。
 * @param {string} username - 用户名。
 * @param {{id?: string, title?: string, charname?: string}} session - 会话。
 * @returns {Promise<void>}
 */
export async function notifyCodeCompletion(username, session) {
	try {
		const body = await geti18nForUser(username, 'code.notify.done')
		await notifyUser(username, {
			title: session?.charname || session?.title || 'fount',
			body,
			url: '/parts/shells:code/',
			tag: session?.id ? `code:${session.id}` : undefined,
		})
	}
	catch { /* 通知失败不影响生成流程 */ }
}

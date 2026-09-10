/**
 * code shell 生成生命周期：完成后通知用户 + 所有任务生成完毕后对选定主机执行电源操作。
 */
import process from 'node:process'

import { notifyUserI18n } from '../../../../../server/web_server/notify/notify.mjs'
import { createTargetExecutor, listMachines } from '../../../plugins/file-operations/src/target.mjs'

/** 允许的电源操作。 */
export const POWER_ACTIONS = new Set(['shutdown', 'sleep', 'restart'])

/** @type {Map<string, number>} 用户名 → 进行中的 code 生成数（跨页面并发）。 */
const activeGenerations = new Map()
/** @type {Map<string, Map<string, string>>} 用户名 → (主机 id → 电源操作)。 */
const pendingPowerActions = new Map()

/**
 * 标记一次 code 生成开始（send / regen 送出前调用）。
 * @param {string} username - 用户名。
 * @returns {void}
 */
export function beginCodeGeneration(username) {
	activeGenerations.set(username, (activeGenerations.get(username) || 0) + 1)
}

/**
 * 标记一次 code 生成结束（done / aborted / error 后调用）；全部结束且已预定电源操作时执行。
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
	const actions = pendingPowerActions.get(username)
	if (!actions?.size) return
	pendingPowerActions.delete(username)
	void runPendingPowerActions(username, actions)
}

/**
 * 读取待电源操作状态（前端按钮展示用）。
 * @param {string} username - 用户名。
 * @returns {{actions: Record<string, string>, active: number}} 状态（主机 id → 操作）。
 */
export function getShutdownState(username) {
	const actions = pendingPowerActions.get(username)
	return { actions: actions ? Object.fromEntries(actions) : {}, active: activeGenerations.get(username) || 0 }
}

/**
 * 预定：所有 code 生成结束后对指定主机执行电源操作（覆盖该主机原设置）。
 * @param {string} username - 用户名。
 * @param {string} machine - 主机 id（"0" = 本机）。
 * @param {string} action - 电源操作（shutdown / sleep / restart）。
 * @returns {{actions: Record<string, string>, active: number}} 写入后的状态。
 */
export function schedulePowerAction(username, machine, action) {
	let actions = pendingPowerActions.get(username)
	if (!actions) {
		actions = new Map()
		pendingPowerActions.set(username, actions)
	}
	actions.set(String(machine), String(action))
	return getShutdownState(username)
}

/**
 * 取消指定主机的预定额电源操作。
 * @param {string} username - 用户名。
 * @param {string} machine - 主机 id。
 * @returns {{actions: Record<string, string>, active: number}} 取消后的状态。
 */
export function cancelPowerAction(username, machine) {
	const actions = pendingPowerActions.get(username)
	if (actions) {
		actions.delete(String(machine))
		if (!actions.size) pendingPowerActions.delete(username)
	}
	return getShutdownState(username)
}

/**
 * 取消全部预定额电源操作。
 * @param {string} username - 用户名。
 * @returns {{actions: Record<string, string>, active: number}} 取消后的状态。
 */
export function cancelAllPowerActions(username) {
	pendingPowerActions.delete(username)
	return getShutdownState(username)
}

/**
 * 派发全部预定额电源操作：分机先派发，本机延后（先让响应/通知送达并送出分机请求，再关闭本机）。
 * @param {string} username - 用户名。
 * @param {Map<string, string>} actions - 主机 id → 电源操作。
 * @returns {Promise<void>}
 */
async function runPendingPowerActions(username, actions) {
	for (const [machine, action] of actions)
		if (String(machine) !== '0') void runHostPowerAction(username, machine, action)
	const local = actions.get('0')
	if (local) {
		await new Promise(resolve => setTimeout(resolve, 800))
		void runHostPowerAction(username, '0', local)
	}
}

/**
 * 对目标主机执行电源操作（走目标机器默认 shell；主机可能随即断电断开）。
 * @param {string} username - 用户名。
 * @param {string} machine - 主机 id（"0" = 本机）。
 * @param {string} action - 电源操作（shutdown / sleep / restart）。
 * @returns {Promise<void>}
 */
async function runHostPowerAction(username, machine, action) {
	const platform = await platformForMachine(username, machine)
	const command = platform ? powerCommand(platform, action) : null
	if (!command) return
	try {
		await createTargetExecutor(username, { machine }).execShell(null, command, { timeoutMs: null })
	}
	catch { /* 主机不可达或已断电：无需处理 */ }
}

/**
 * 目标主机的操作系统平台（本机取进程平台，分机取上报设备信息）。
 * @param {string} username - 用户名。
 * @param {string} machine - 主机 id（"0" = 本机）。
 * @returns {Promise<string|null>} 平台标识（win32 / darwin / linux…）；未知为 null。
 */
async function platformForMachine(username, machine) {
	if (String(machine) === '0') return process.platform
	try {
		const target = (await listMachines(username)).find(m => String(m.id) === String(machine))
		return target?.deviceInfo?.os?.platform || null
	}
	catch { return null }
}

/**
 * 平台 + 操作 → 系统电源命令。
 * @param {string} platform - 平台标识（win32 / darwin / linux…）。
 * @param {string} action - 电源操作（shutdown / sleep / restart）。
 * @returns {string|null} 命令；未知组合为 null。
 */
function powerCommand(platform, action) {
	if (platform === 'win32') {
		if (action === 'shutdown') return 'shutdown /s /t 0'
		if (action === 'restart') return 'shutdown /r /t 0'
		if (action === 'sleep') return 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
	}
	else if (platform === 'darwin') {
		if (action === 'shutdown') return 'osascript -e \'tell application "System Events" to shut down\''
		if (action === 'restart') return 'osascript -e \'tell application "System Events" to restart\''
		if (action === 'sleep') return 'pmset sleepnow'
	}
	else {
		if (action === 'shutdown') return 'systemctl poweroff'
		if (action === 'restart') return 'systemctl reboot'
		if (action === 'sleep') return 'systemctl suspend'
	}
	return null
}

/**
 * 角色回复完成后向用户推送通知（浏览器在线经 /ws/notify，离线回退 Web Push）。
 * @param {string} username - 用户名。
 * @param {{id?: string, title?: string, charname?: string}} session - 会话。
 * @returns {Promise<void>}
 */
export async function notifyCodeCompletion(username, session) {
	try {
		const params = new URLSearchParams()
		if (session?.workspaceId) params.set('workspace', session.workspaceId)
		if (session?.id) params.set('session', session.id)
		const url = '/parts/shells:code/' + (params.toString() ? `?${params.toString()}` : '')
		await notifyUserI18n(username, {
			title: session?.charname || session?.title || 'fount',
			bodyKey: 'code.notify.done',
			url,
			tag: session?.id ? `code:${session.id}` : undefined,
		})
	}
	catch { /* 通知失败不影响生成流程 */ }
}

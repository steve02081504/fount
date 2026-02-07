import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs'
import { getAllContextData, runWithContexts } from 'npm:als-registry'

import { getUserByUsername, getAllUserNames } from './auth.mjs'
import { loadPart } from './parts_loader.mjs'
import { save_config } from './server.mjs'

/**
 * 为用户设置一个新计时器。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {string} uid - 计时器的唯一标识符。
 * @param {object} options - 计时器选项。
 * @param {string} options.trigger - 计时器的触发条件。
 * @param {any} options.callbackdata - 传递给回调函数的数据。
 * @param {boolean} [options.repeat=false] - 计时器是否应重复。
 * @returns {void}
 */
export function setTimer(username, partpath, uid, { trigger, callbackdata, repeat }) {
	const timers = getUserByUsername(username).timers ??= {}
	timers[partpath] ??= {}
	timers[partpath][uid] = {
		trigger,
		callbackdata,
		repeat: repeat ?? false,
		asynccontexts: getAllContextData()
	}
	try {
		save_config()
	}
	catch (err) {
		console.error(err)
		removeTimer(username, partpath, uid)
	}
}

/**
 * 为用户移除一个计时器。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @param {string} uid - 计时器的唯一标识符。
 * @returns {void}
 */
export function removeTimer(username, partpath, uid) {
	const timers = getUserByUsername(username).timers ?? {}
	if (timers[partpath]?.[uid]) {
		delete timers[partpath][uid]
		if (!Object.keys(timers[partpath]).length)
			delete timers[partpath]

		save_config()
	}
	else {
		console.warn('Timer not found:', { username, partpath, uid })
		throw new Error('Timer not found')
	}
}

/**
 * 获取特定部件的所有计时器。
 * @param {string} username - 用户的用户名。
 * @param {string} partpath - 部件的路径。
 * @returns {object} 包含指定部件的计时器的对象。
 */
export function getTimers(username, partpath) {
	const timers = getUserByUsername(username).timers ?? {}
	return timers[partpath] ?? {}
}

/**
 * 检查并触发计时器的主心跳函数。
 * @returns {Promise<void>}
 */
async function TimerHeartbeat() {
	const users = getAllUserNames()
	let need_save = false
	for (const user of users) {
		const timers = getUserByUsername(user).timers ?? {}
		for (const partpath in timers)
			for (const uid in timers[partpath]) {
				const timer = timers[partpath][uid]
				if (!timer.triggered && (timer.triggered = !!await async_eval(timer.trigger).then(v => v.result))) { // 确保触发条件只在跳变时生效一次
					if (!timer.repeat) removeTimer(user, partpath, uid) // 先移除避免重复触发
					try {
						const part = await loadPart(user, partpath)
						await runWithContexts(timer.asynccontexts, () =>
							part.interfaces.timers.TimerCallback(user, uid, timer.callbackdata)
						)
						need_save = true
					} catch (err) { console.error(err) }
				}
			}
	}
	if (need_save) save_config()
}

/**
 * 计时器心跳的定时器。
 * @type {number}
 */
let timer_heartbeat_interval = null
/**
 * 启动计时器心跳。
 * @returns {void}
 */
export function startTimerHeartbeat() {
	timer_heartbeat_interval ??= setInterval(TimerHeartbeat, 500)
}
/**
 * 停止计时器心跳。
 * @returns {void}
 */
export function stopTimerHeartbeat() {
	if (timer_heartbeat_interval) clearInterval(timer_heartbeat_interval)
	timer_heartbeat_interval = null
}
/**
 * 重启计时器心跳。
 * @returns {void}
 */
export function restartTimerHeartbeat() {
	stopTimerHeartbeat()
	startTimerHeartbeat()
}

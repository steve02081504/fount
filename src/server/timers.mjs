import { async_eval } from 'https://cdn.jsdelivr.net/gh/steve02081504/async-eval/deno.mjs'
import { getAllContextData, runWithContexts } from 'npm:als-registry'

import { getUserByUsername, getAllUserNames } from './auth.mjs'
import { loadPart } from './managers/index.mjs'
import { save_config } from './server.mjs'

/**
 * 为用户设置一个新计时器。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {string} uid - 计时器的唯一标识符。
 * @param {object} options - 计时器选项。
 * @param {string} options.trigger - 计时器的触发条件。
 * @param {any} options.callbackdata - 传递给回调函数的数据。
 * @param {boolean} [options.repeat=false] - 计时器是否应重复。
 * @returns {void}
 */
export function setTimer(username, parttype, partname, uid, { trigger, callbackdata, repeat }) {
	const timers = getUserByUsername(username).timers ??= {}
	timers[parttype] ??= {}
	timers[parttype][partname] ??= {}
	timers[parttype][partname][uid] = {
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
		removeTimer(username, parttype, partname, uid)
	}
}

/**
 * 为用户移除一个计时器。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @param {string} uid - 计时器的唯一标识符。
 * @returns {void}
 */
export function removeTimer(username, parttype, partname, uid) {
	const timers = getUserByUsername(username).timers ?? {}
	if (timers[parttype]?.[partname]?.[uid]) {
		delete timers[parttype][partname][uid]
		if (!Object.keys(timers[parttype][partname]).length) {
			delete timers[parttype][partname]
			if (!Object.keys(timers[parttype]).length)
				delete timers[parttype]
		}
		save_config()
	}
	else {
		console.warn('Timer not found:', { username, parttype, partname, uid })
		throw new Error('Timer not found')
	}
}

/**
 * 获取特定部件的所有计时器。
 * @param {string} username - 用户的用户名。
 * @param {string} parttype - 部件的类型。
 * @param {string} partname - 部件的名称。
 * @returns {object} 包含指定部件的计时器的对象。
 */
export function getTimers(username, parttype, partname) {
	const timers = getUserByUsername(username).timers ?? {}
	return timers[parttype]?.[partname] ?? {}
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
		for (const parttype in timers)
			for (const partname in timers[parttype])
				for (const uid in timers[parttype][partname]) {
					const timer = timers[parttype][partname][uid]
					if (!timer.triggered && (timer.triggered = !!await async_eval(timer.trigger).then(v => v.result))) { // 确保触发条件只在跳变时生效一次
						if (!timer.repeat) removeTimer(user, parttype, partname, uid) // 先移除避免重复触发
						try {
							const part = await loadPart(user, parttype, partname)
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
 * 启动计时器心跳。
 * @returns {void}
 */
export function startTimerHeartbeat() {
	setInterval(TimerHeartbeat, 500)
}

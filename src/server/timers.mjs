import { getUserByUsername } from './auth.mjs'
import { getAllUserNames } from './auth.mjs'
import { save_config } from './server.mjs'
import { loadPart } from './managers/index.mjs'

export function setTimer(username, parttype, partname, uid, { trigger, callbackdata, repeat }) {
	const timers = getUserByUsername(username).timers ??= {}
	timers[parttype] ??= {}
	timers[parttype][partname] ??= {}
	timers[parttype][partname][uid] = {
		trigger,
		callbackdata,
		repeat: repeat ?? false,
	}
	save_config()
}

export function removeTimer(username, parttype, partname, uid) {
	const timers = getUserByUsername(username).timers ?? {}
	if (timers[parttype]?.[partname]?.[uid]) {
		delete timers[parttype][partname][uid]
		if (Object.keys(timers[parttype][partname]).length === 0)
			delete timers[parttype][partname]
	}
	save_config()
}

export function getTimers(username, parttype, partname) {
	const timers = getUserByUsername(username).timers ?? {}
	return timers[parttype]?.[partname] ?? {}
}

async function TimerHeartbeat() {
	const users = getAllUserNames()
	for (const user of users) {
		const timers = getUserByUsername(user).timers ?? {}
		for (const parttype in timers)
			for (const partname in timers[parttype])
				for (const uid in timers[parttype][partname]) {
					const timer = timers[parttype][partname][uid]
					if (!timer.triggered && (timer.triggered = !!eval(timer.trigger))) { // 确保触发条件只在跳变时生效一次
						if (!timer.repeat) removeTimer(user, parttype, partname, uid) // 先移除避免重复触发
						try {
							const part = await loadPart(user, parttype, partname)
							part.interfaces.timers.TimerCallback(user, uid, timer.callbackdata)
						} catch (err) {
							console.error(err)
						}
					}
				}
	}
}

export function startTimerHeartbeat() {
	setInterval(TimerHeartbeat, 500)
}

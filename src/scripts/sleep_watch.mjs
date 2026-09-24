/** 进程内休眠监测：延迟超过五分钟的 1s tick 视为系统暂停。 */
const INTERVAL_MS = 1000
const MIN_SLEEP_MS = 5 * 60 * 1000
let lastTick = Date.now()
let pausedMs = 0
const listeners = new Set()

/**
 * 检查计时器延迟并通知运行中的任务。可由限时回调主动调用，避免它先于 watcher 醒来。
 * @param {number} [now=Date.now()] 当前时间
 * @returns {number} 本次检测到的停机时长
 */
export function checkForSleep(now = Date.now()) {
	const gap = now - lastTick
	lastTick = now
	if (gap <= MIN_SLEEP_MS) return 0
	const duration = gap - INTERVAL_MS
	pausedMs += duration
	for (const listener of [...listeners]) listener(duration)
	return duration
}

/** @returns {number} 排除系统休眠后的当前时间。 */
export function awakeNow() {
	checkForSleep()
	return Date.now() - pausedMs
}

/**
 * 订阅休眠通知；解除订阅后不会再被调用。
 * @param {(duration: number) => void} listener 接收休眠时长（毫秒）
 * @returns {() => void} 解除订阅
 */
export function onSystemWake(listener) {
	checkForSleep()
	listeners.add(listener)
	return () => listeners.delete(listener)
}

/**
 * 仅计入清醒时间的超时计时器；回调先检查休眠间隔。
 * @param {() => void} callback 超时回调
 * @param {number} duration 限时毫秒
 * @returns {() => void} 取消计时器
 */
export function setAwakeTimeout(callback, duration) {
	const deadline = awakeNow() + Math.max(0, duration)
	let timer
	let cancelled = false
	/**
	 *
	 */
	const tick = () => {
		if (cancelled) return
		const remaining = deadline - awakeNow()
		if (remaining <= 0) callback()
		else timer = setTimeout(tick, remaining)
	}
	timer = setTimeout(tick, Math.max(0, duration))
	return () => { cancelled = true; clearTimeout(timer) }
}

const watcher = setInterval(checkForSleep, INTERVAL_MS)
watcher.unref?.()

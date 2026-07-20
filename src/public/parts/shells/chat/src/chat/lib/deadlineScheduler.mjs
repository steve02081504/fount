/**
 * 按 key 去重的截止调度器。已到期则立即 fire；否则 setTimeout。
 * @returns {{ schedule: (key: string, deadlineMs: number, fire: () => void | Promise<void>) => void | Promise<void>, clear: (key: string) => void, clearAll: () => void }} 调度器
 */
export function createDeadlineScheduler() {
	/** @type {Map<string, ReturnType<typeof setTimeout>>} */
	const timers = new Map()

	/**
	 * @param {string} key 调度键
	 * @returns {void}
	 */
	function clear(key) {
		const timer = timers.get(key)
		if (!timer) return
		clearTimeout(timer)
		timers.delete(key)
	}

	/**
	 * @returns {void}
	 */
	function clearAll() {
		for (const timer of timers.values()) clearTimeout(timer)
		timers.clear()
	}

	/**
	 * @param {string} key 调度键
	 * @param {number} deadlineMs 截止时间（epoch ms）
	 * @param {() => void | Promise<void>} fire 到期回调
	 * @returns {void | Promise<void>} 已到期时返回 fire() 的结果以便调用方可 await
	 */
	function schedule(key, deadlineMs, fire) {
		if (timers.has(key)) return
		const delay = deadlineMs - Date.now()
		if (delay <= 0) return fire()
		const timer = setTimeout(() => {
			timers.delete(key)
			void fire()
		}, delay)
		timers.set(key, timer)
	}

	return { schedule, clear, clearAll }
}

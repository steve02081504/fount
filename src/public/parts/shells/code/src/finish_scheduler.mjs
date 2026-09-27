/**
 * code shell 延迟收尾调度（纯逻辑，无 IO）：登记一个待执行任务，延迟到期后执行；
 * 期间 `touch` 重置计时（用户继续输入），`cancel` 取消任务（用户发新消息，任务交给下一轮）。
 * 计时器可注入，便于单测。
 */

/**
 * 创建一个延迟收尾调度器。
 * @param {object} options - 选项。
 * @param {number} options.delayMs - 延迟毫秒数。
 * @param {(payload: any) => void} options.onRun - 到期执行（已从待办中移除）。
 * @param {typeof setTimeout} [options.setTimer] - 计时器（可注入）。
 * @param {typeof clearTimeout} [options.clearTimer] - 取消计时器（可注入）。
 * @returns {{schedule: (key: string, payload: any) => any, touch: (key: string) => boolean, cancel: (key: string) => any}} 调度器。
 */
export function createDeferredFinish({ delayMs, onRun, setTimer = setTimeout, clearTimer = clearTimeout }) {
	/** @type {Map<string, {timer: any, payload: any}>} 待运行任务：键 → 计时器与载荷。 */
	const pending = new Map()

	/**
	 * 装载（或重置）一个键的计时器。
	 * @param {string} key - 任务键。
	 * @param {any} payload - 到期载荷。
	 * @returns {void}
	 */
	function arm(key, payload) {
		pending.set(key, {
			payload,
			timer: setTimer(() => {
				pending.delete(key)
				onRun(payload)
			}, delayMs),
		})
	}

	/**
	 * 登记/覆盖一个延迟任务（覆盖时返回被替换的旧载荷，调用方负责善后）。
	 * @param {string} key - 任务键。
	 * @param {any} payload - 到期载荷。
	 * @returns {any} 被覆盖的旧载荷（无则 null）。
	 */
	function schedule(key, payload) {
		const existing = pending.get(key)
		if (existing) clearTimer(existing.timer)
		arm(key, payload)
		return existing?.payload ?? null
	}

	/**
	 * 重置某任务的计时（用户继续输入）。
	 * @param {string} key - 任务键。
	 * @returns {boolean} 是否存在并已重置。
	 */
	function touch(key) {
		const entry = pending.get(key)
		if (!entry) return false
		clearTimer(entry.timer)
		arm(key, entry.payload)
		return true
	}

	/**
	 * 取消某任务并返回其载荷（不存在返回 null）。
	 * @param {string} key - 任务键。
	 * @returns {any} 被取消的载荷（无则 null）。
	 */
	function cancel(key) {
		const entry = pending.get(key)
		if (!entry) return null
		clearTimer(entry.timer)
		pending.delete(key)
		return entry.payload
	}

	return { schedule, touch, cancel }
}

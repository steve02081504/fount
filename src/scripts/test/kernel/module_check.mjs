/**
 * Deno node_modules 物化互斥闸：同时只允许一个进程处于 spawn→ready 窗口。
 */

import { randomUUID } from 'node:crypto'

import { ms } from '../../ms.mjs'

/** spawn→ready 窗口上限；超时视为持有者已死，释放等待者。与 suite idle watchdog 对齐。 */
export const MODULE_CHECK_HOLD_TIMEOUT_MS = ms('10m')

/**
 * 无任何实测样本时的模块检查均值兜底（毫秒）。
 * 避免调度 ETA 一开始把 spawn→ready 互斥窗当成 0，导致「2 分钟 → 24 分钟」的跳变。
 */
export const DEFAULT_MODULE_CHECK_MS = 40_000

/**
 * @param {AbortSignal} [signal] 取消信号
 * @returns {Error} AbortError
 */
function abortError(signal) {
	if (signal?.reason instanceof Error) return signal.reason
	return new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * 模组检查租约闸门。
 */
export class ModuleCheckGate {
	/**
	 * @param {object} [options] 选项
	 * @param {number} [options.holdTimeoutMs] 持有未 ready 的上限；默认 {@link MODULE_CHECK_HOLD_TIMEOUT_MS}
	 * @param {(ticket: string, heldMs: number) => void} [options.onHoldTimeout] 持有超时回调
	 * @param {number} [options.defaultMeanMs] 无样本时的兜底均值；默认 {@link DEFAULT_MODULE_CHECK_MS}
	 * @param {number} [options.initialTotal] 历史累计检查时长（持久化恢复）
	 * @param {number} [options.initialCount] 历史检查次数（持久化恢复）
	 * @param {(totalMs: number, count: number) => void} [options.onUpdate] 每次记录 ready 后回调（用于持久化）
	 */
	constructor({
		holdTimeoutMs = MODULE_CHECK_HOLD_TIMEOUT_MS,
		onHoldTimeout,
		defaultMeanMs = DEFAULT_MODULE_CHECK_MS,
		initialTotal = 0,
		initialCount = 0,
		onUpdate,
	} = {}) {
		/** @type {string | null} */
		this.heldTicket = null
		this.heldAt = 0
		this.holdTimeoutMs = holdTimeoutMs
		this.onHoldTimeout = onHoldTimeout
		this.defaultMeanMs = defaultMeanMs
		this.onUpdate = onUpdate
		/** @type {{ resolve: (ticket: string) => void, reject: (error: Error) => void }[]} */
		this.#waiters = []
		/** @type {ReturnType<typeof setTimeout> | null} */
		this.#holdTimer = null
		/** @type {Set<string>} */
		this.#pendingReady = new Set()
		/** @type {number} */
		this.durationTotalMs = initialTotal
		/** @type {number} */
		this.durationCount = initialCount
	}

	#waiters
	#holdTimer
	#pendingReady

	/**
	 * 当前排队等待租约的数量。
	 * @returns {number} 等待者数
	 */
	get waiting() {
		return this.#waiters.length
	}

	/**
	 * 等待并占用闸门，返回 ticket（spawn 前调用）。
	 * @param {AbortSignal} [signal] 取消等待（已占用的 ticket 不受影响）
	 * @returns {Promise<string>} ticket
	 */
	acquire(signal) {
		if (signal?.aborted) return Promise.reject(abortError(signal))
		if (!this.heldTicket) return Promise.resolve(this.#take())
		return new Promise((resolve, reject) => {
			/** @type {{ resolve: (ticket: string) => void, reject: (error: Error) => void }} */
			const waiter = { resolve, reject }
			this.#waiters.push(waiter)
			signal?.addEventListener('abort', () => {
				const index = this.#waiters.indexOf(waiter)
				if (index < 0) return
				this.#waiters.splice(index, 1)
				reject(abortError(signal))
			}, { once: true })
		})
	}

	/**
	 * @returns {string} 新 ticket
	 */
	#take() {
		const ticket = randomUUID()
		this.heldTicket = ticket
		this.heldAt = Date.now()
		this.#pendingReady.add(ticket)
		this.#armHoldTimer()
		return ticket
	}

	/** 持有未 ready 时启动超时；已有则重置。 */
	#armHoldTimer() {
		if (this.#holdTimer) {
			clearTimeout(this.#holdTimer)
			this.#holdTimer = null
		}
		if (this.holdTimeoutMs == null || this.holdTimeoutMs === Infinity) return
		this.#holdTimer = setTimeout(() => {
			this.#holdTimer = null
			const ticket = this.heldTicket
			if (!ticket) return
			const heldMs = Date.now() - this.heldAt
			this.#release(ticket, false)
			this.onHoldTimeout?.(ticket, heldMs)
		}, this.holdTimeoutMs)
	}

	/**
	 * @param {string} ticket 租约
	 * @param {boolean} recordDuration 是否记入均值
	 * @returns {number | null} 本次时长；ticket 不匹配则为 null
	 */
	#release(ticket, recordDuration) {
		if (!ticket || ticket !== this.heldTicket) return null
		const duration = Date.now() - this.heldAt
		if (recordDuration) {
			this.durationTotalMs += duration
			this.durationCount++
			this.onUpdate?.(this.durationTotalMs, this.durationCount)
		}
		this.heldTicket = null
		if (this.#holdTimer) {
			clearTimeout(this.#holdTimer)
			this.#holdTimer = null
		}
		this.#waiters.shift()?.resolve(this.#take())
		return duration
	}

	/**
	 * 子进程 ready：释放闸门并记录时长。
	 * @param {string} ticket 租约
	 * @returns {number | null} 本次检查时长；ticket 不匹配则为 null
	 */
	ready(ticket) {
		this.#pendingReady.delete(ticket)
		return this.#release(ticket, true)
	}

	/**
	 * 子进程未 ready 就结束：释放等待者，不记时长。
	 * hold 超时后互斥已释放，此处为 false，未 ready 信息仍在 {@link consumeMissedReady}。
	 * @param {string} ticket 租约
	 * @returns {boolean} 仍持有该 ticket
	 */
	abandon(ticket) {
		return this.#release(ticket, false) != null
	}

	/**
	 * 任务退出时取走未 ready 状态并释放互斥（若仍占用）。
	 * hold 超时后 abandon 为 false，只要从未 ready 仍为 true。
	 * @param {string} ticket 租约
	 * @returns {boolean} 从未收到 ready
	 */
	consumeMissedReady(ticket) {
		if (!ticket) return false
		const pending = this.#pendingReady.delete(ticket)
		this.#release(ticket, false)
		return pending
	}

	/**
	 * 关掉闸门：清定时器、拒掉等待者。内核退出时调用。
	 * @returns {void}
	 */
	close() {
		if (this.#holdTimer) {
			clearTimeout(this.#holdTimer)
			this.#holdTimer = null
		}
		this.heldTicket = null
		this.#pendingReady.clear()
		const waiters = this.#waiters.splice(0)
		const error = abortError()
		for (const waiter of waiters) waiter.reject(error)
	}

	/**
	 * 最近检查时长均值；无实测样本则用 {@link defaultMeanMs} 兜底，避免调度把互斥窗当 0。
	 * @returns {number} 毫秒
	 */
	meanDurationMs() {
		if (!this.durationCount) return this.defaultMeanMs
		return Math.round(this.durationTotalMs / this.durationCount)
	}
}

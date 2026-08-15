/**
 * Deno node_modules 物化互斥闸：同时只允许一个进程处于 spawn→ready 窗口。
 */

import { randomUUID } from 'node:crypto'

import { ms } from '../../ms.mjs'

/** spawn→ready 窗口上限；超时视为持有者已死，释放等待者。与 suite idle watchdog 对齐。 */
export const MODULE_CHECK_HOLD_TIMEOUT_MS = ms('10m')

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
	 */
	constructor({ holdTimeoutMs = MODULE_CHECK_HOLD_TIMEOUT_MS, onHoldTimeout } = {}) {
		/** @type {string | null} */
		this.heldTicket = null
		this.heldAt = 0
		this.holdTimeoutMs = holdTimeoutMs
		this.onHoldTimeout = onHoldTimeout
		/** @type {{ resolve: (ticket: string) => void, reject: (error: Error) => void }[]} */
		this.#waiters = []
		/** @type {ReturnType<typeof setTimeout> | null} */
		this.#holdTimer = null
		/** @type {number} */
		this.durationTotalMs = 0
		/** @type {number} */
		this.durationCount = 0
	}

	#waiters
	#holdTimer

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
				const idx = this.#waiters.indexOf(waiter)
				if (idx < 0) return
				this.#waiters.splice(idx, 1)
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
		}
		this.heldTicket = null
		if (this.#holdTimer) {
			clearTimeout(this.#holdTimer)
			this.#holdTimer = null
		}
		const next = this.#waiters.shift()
		if (next) next.resolve(this.#take())
		return duration
	}

	/**
	 * 子进程 ready：释放闸门并记录时长。
	 * @param {string} ticket 租约
	 * @returns {number | null} 本次检查时长；ticket 不匹配则为 null
	 */
	ready(ticket) {
		return this.#release(ticket, true)
	}

	/**
	 * 子进程未 ready 就结束：释放等待者，不记时长。
	 * @param {string} ticket 租约
	 * @returns {boolean} 仍持有该 ticket（missed）
	 */
	abandon(ticket) {
		return this.#release(ticket, false) != null
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
		const waiters = this.#waiters.splice(0)
		const error = abortError()
		for (const waiter of waiters) waiter.reject(error)
	}

	/**
	 * 最近检查时长均值；无样本则 0。
	 * @returns {number} 毫秒
	 */
	meanDurationMs() {
		if (!this.durationCount) return 0
		return Math.round(this.durationTotalMs / this.durationCount)
	}
}

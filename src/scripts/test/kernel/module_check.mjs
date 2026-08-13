/**
 * Deno node_modules 物化互斥闸：同时只允许一个进程处于 spawn→ready 窗口。
 */

import { randomUUID } from 'node:crypto'

/**
 * 模组检查租约闸门。
 */
export class ModuleCheckGate {
	/** 空闸。 */
	constructor() {
		/** @type {string | null} */
		this.heldTicket = null
		this.heldAt = 0
		/** @type {((ticket: string) => void)[]} */
		this.#waiters = []
		/** @type {number[]} */
		this.durations = []
	}

	#waiters

	/**
	 * 等待并占用闸门，返回 ticket（spawn 前调用）。
	 * @returns {Promise<string>} ticket
	 */
	acquire() {
		if (!this.heldTicket) {
			const ticket = randomUUID()
			this.heldTicket = ticket
			this.heldAt = Date.now()
			return Promise.resolve(ticket)
		}
		return new Promise(resolve => {
			this.#waiters.push(resolve)
		})
	}

	/**
	 * @param {string} ticket 租约
	 * @param {boolean} recordDuration 是否记入均值
	 * @returns {number | null} 本次时长；ticket 不匹配则为 null
	 */
	#release(ticket, recordDuration) {
		if (!ticket || ticket !== this.heldTicket) return null
		const duration = Date.now() - this.heldAt
		if (recordDuration) this.durations.push(duration)
		this.heldTicket = null
		const next = this.#waiters.shift()
		if (next) {
			const nextTicket = randomUUID()
			this.heldTicket = nextTicket
			this.heldAt = Date.now()
			next(nextTicket)
		}
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
	 * 最近检查时长均值；无样本则 0。
	 * @returns {number} 毫秒
	 */
	meanDurationMs() {
		if (!this.durations.length) return 0
		return Math.round(this.durations.reduce((a, b) => a + b, 0) / this.durations.length)
	}
}

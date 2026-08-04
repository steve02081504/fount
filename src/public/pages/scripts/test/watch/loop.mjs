/**
 * 单一 watch loop：任务轮转，无 backlog，串行防撞车。
 *
 * `run(ctx)` 返回 true = 空转（立刻下一条）；false = 干了事（按 delayMs 再约）。
 * 整轮皆空则停住等 `wake`。`drain()` 先调各任务 `beginDrain`，再跑到全部 `covered`。
 * 未 `start()` 前 `wake` / `drain` 均为 no-op。
 */

/**
 * @typedef {{ draining: boolean }} WatchTickContext
 */

/**
 * @typedef {{
 *   name: string,
 *   delayMs: number,
 *   run: (ctx: WatchTickContext) => boolean | Promise<boolean>,
 *   covered: () => boolean,
 *   beginDrain?: () => void,
 * }} WatchTask
 */

/**
 * 任务轮转调度器。
 */
export class WatchLoop {
	/** @type {WatchTask[]} */
	#tasks = []
	#cursor = 0
	#timer = 0
	#running = false
	#started = false
	#draining = false
	#pendingWake = false
	#idleStreak = 0
	/** @type {((error?: Error) => void)[]} */
	#drainWaiters = []
	/** @type {import('./reporter.mjs').WatchReporter} */
	#reporter

	/**
	 * @param {{ reporter: import('./reporter.mjs').WatchReporter }} options 选项
	 */
	constructor({ reporter }) {
		this.#reporter = reporter
	}

	/**
	 * 是否处于收尾 drain。
	 * @returns {boolean} draining
	 */
	get draining() {
		return this.#draining
	}

	/**
	 * 是否已开闸。
	 * @returns {boolean} started
	 */
	get started() {
		return this.#started
	}

	/**
	 * @param {WatchTask} task 任务
	 * @returns {void}
	 */
	register(task) {
		this.#tasks.push(task)
	}

	/**
	 * 开闸并启动调度。
	 * @returns {void}
	 */
	start() {
		if (this.#started) return
		this.#started = true
		this.#schedule(0)
	}

	/**
	 * 唤醒停住的 loop（或缩短已约的等待）。
	 * 任务执行中则记 pending，tick 收尾再排。
	 * @returns {void}
	 */
	wake() {
		if (!this.#started) return
		if (this.#running) {
			this.#pendingWake = true
			return
		}
		this.#idleStreak = 0
		this.#schedule(0)
	}

	/**
	 * 测试收尾：通知各任务 beginDrain，再跑到全部 covered。
	 * @returns {Promise<void>}
	 */
	drain() {
		if (!this.#started || !this.#tasks.length) return Promise.resolve()
		if (this.#draining)
			return new Promise(resolve => this.#drainWaiters.push(resolve))

		this.#draining = true
		for (const task of this.#tasks) task.beginDrain?.()

		return new Promise(resolve => {
			this.#drainWaiters.push(resolve)
			if (!this.#running) this.#schedule(0)
		})
	}

	/**
	 * 各任务覆盖目标是否均已达成。
	 * @returns {boolean} 全部 covered 则为 true
	 */
	#allCovered() {
		return this.#tasks.length > 0 && this.#tasks.every(task => task.covered())
	}

	/**
	 * 若 drain 条件满足则结束并唤醒 waiters。
	 * @returns {void}
	 */
	#resolveDrain() {
		if (!this.#draining || !this.#allCovered() || this.#running || this.#timer) return
		this.#draining = false
		for (const resolve of this.#drainWaiters.splice(0)) resolve()
	}

	/**
	 * @param {number} delayMs 延迟
	 * @returns {void}
	 */
	#schedule(delayMs) {
		if (this.#timer) clearTimeout(this.#timer)
		this.#timer = setTimeout(() => {
			this.#timer = 0
			void this.#tick()
		}, delayMs)
	}

	/**
	 * @returns {Promise<void>}
	 */
	async #tick() {
		if (!this.#tasks.length || this.#running) return
		if (this.#draining && this.#allCovered()) {
			this.#resolveDrain()
			return
		}

		const task = this.#tasks[this.#cursor % this.#tasks.length]
		this.#cursor++
		this.#running = true
		this.#pendingWake = false
		let idle = false
		try {
			idle = await task.run({ draining: this.#draining }) === true
		}
		catch (error) {
			this.#reporter.report(
				`tick-failed\t${task.name}\t${String(error?.message || error)}`,
				'tick-failed',
				task.name,
				String(error?.message || error),
			)
			idle = false
		}
		finally {
			this.#running = false
		}

		if (this.#pendingWake) {
			this.#pendingWake = false
			this.#idleStreak = 0
			this.#schedule(0)
			return
		}

		if (this.#draining && this.#allCovered()) {
			this.#resolveDrain()
			return
		}

		if (idle) {
			this.#idleStreak++
			if (this.#idleStreak >= this.#tasks.length) {
				this.#idleStreak = 0
				if (this.#draining) {
					if (this.#allCovered()) this.#resolveDrain()
					else this.#schedule(Math.min(...this.#tasks.map(item => item.delayMs)))
					return
				}
				return
			}
			this.#schedule(0)
			return
		}

		this.#idleStreak = 0
		this.#schedule(task.delayMs)
	}
}

/**
 * 单一 watch loop：任务轮转，无 backlog，串行防撞车。
 *
 * `run(ctx)` 返回 true = 空转（立刻下一条）；false = 干了事（按 delayMs 再约）。
 * 整轮皆空则停住等 `wake`。`drain()` 先调各任务 `beginDrain`，再跑到全部 `covered`。
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
	#draining = false
	#idleStreak = 0
	/** @type {((error?: Error) => void)[]} */
	#drainWaiters = []
	/** 失败日志前缀（缺省通用） */
	#failPrefix

	/**
	 * @param {{ failPrefix?: string }} [options] 选项
	 */
	constructor(options = {}) {
		this.#failPrefix = options.failPrefix || '[watch]'
	}

	/**
	 * 是否处于收尾 drain。
	 * @returns {boolean} draining
	 */
	get draining() {
		return this.#draining
	}

	/**
	 * @param {WatchTask} task 任务
	 * @returns {void}
	 */
	register(task) {
		this.#tasks.push(task)
	}

	/**
	 * 唤醒停住的 loop（或缩短已约的等待）。
	 * @returns {void}
	 */
	wake() {
		if (this.#running) return
		this.#idleStreak = 0
		this.#schedule(0)
	}

	/**
	 * 测试收尾：通知各任务 beginDrain，再跑到全部 covered。
	 * @returns {Promise<void>}
	 */
	drain() {
		if (!this.#tasks.length) return Promise.resolve()
		if (this.#draining)
			return new Promise(resolve => this.#drainWaiters.push(resolve))

		this.#draining = true
		for (const task of this.#tasks) task.beginDrain?.()

		if (this.#allCovered() && !this.#running && !this.#timer) {
			this.#draining = false
			return Promise.resolve()
		}

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
		let idle = false
		try {
			idle = await task.run({ draining: this.#draining }) === true
		}
		catch (error) {
			console.error(this.#failPrefix, 'tick-failed', task.name, String(error?.message || error))
			globalThis.fount.test.watchLastRun = Date.now()
			idle = false
		}
		finally {
			this.#running = false
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

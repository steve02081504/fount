/**
 * suite 并发调度：heavy 套件独占，非 heavy 按上限并行。
 */

/**
 * @typedef {import('../core/manifest.mjs').SuiteDef} SuiteDef
 */

/**
 * heavy 独占 + 非 heavy 并行上限的 suite 运行闸门。
 */
export class SuiteRunGate {
	/**
	 * @param {number} maxLightConcurrency 非 heavy suite 最大并行数
	 */
	constructor(maxLightConcurrency) {
		this.maxLight = Math.max(1, maxLightConcurrency)
		this.heavyRunning = false
		this.lightRunning = 0
		/** @type {(() => void)[]} */
		this.waiters = []
	}

	/**
	 * 等待并获取运行槽位。
	 * @param {SuiteDef} suite 待运行 suite
	 * @returns {Promise<() => void>} 释放函数
	 */
	async acquire(suite) {
		return new Promise(resolve => {
			/**
			 * 尝试进入运行槽。
			 */
			const tryEnter = () => {
				if (suite.heavy) {
					if (!this.heavyRunning && this.lightRunning === 0) {
						this.heavyRunning = true
						resolve(() => this.#releaseHeavy())
						return
					}
				}
				else if (!this.heavyRunning && this.lightRunning < this.maxLight) {
					this.lightRunning++
					resolve(() => this.#releaseLight())
					return
				}
				this.waiters.push(tryEnter)
			}
			tryEnter()
		})
	}

	/** 释放 heavy 独占槽位并唤醒等待中的 worker。 */
	#releaseHeavy() {
		this.heavyRunning = false
		this.#drain()
	}

	/** 释放一个 light 并行槽位并唤醒等待中的 worker。 */
	#releaseLight() {
		this.lightRunning--
		this.#drain()
	}

	/** 依次唤醒所有等待获取运行槽位的 worker。 */
	#drain() {
		const pending = this.waiters.splice(0)
		for (const next of pending) next()
	}
}

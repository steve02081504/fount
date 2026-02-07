/**
 * @typedef {object} IdleManagerConfig
 * @property {number} timeout - 在考虑系统空闲之前等待的毫秒数。
 * @property {number} checkInterval - 空闲检查之间的毫秒数。
 */
const defaultConfig = {
	timeout: 30000, // 30 seconds
	checkInterval: 5 * 60 * 1000 // 5 minutes
}

/**
 * 管理和监视系统空闲状态，在系统不繁忙时执行任务。
 */
export class IdleManager {
	#lastBusyTime
	#runningActions = 0
	#idleRuns = []
	#idleRunOnces = []
	#config
	#timeoutId = null
	#stopped = true

	/**
	 * 创建 IdleManager 的实例。
	 * @param {Partial<IdleManagerConfig>} [config={}] - 配置选项。
	 */
	constructor(config = {}) {
		this.#config = { ...defaultConfig, ...config }
		this.#lastBusyTime = Date.now()
	}

	/**
	 * 将系统标记为繁忙。
	 * @returns {void}
	 */
	markBusy() {
		this.#lastBusyTime = Date.now()
	}

	/**
	 * 包装并执行一个动作，跟踪其运行状态。
	 * @param {Function} action 要执行的异步动作。
	 * @returns {Promise<any>} 动作的结果。
	 */
	async runAction(action) {
		this.#runningActions++
		try {
			return await action()
		}
		finally {
			this.#runningActions--
		}
	}

	/**
	 * 将系统标记为繁忙，然后执行一个动作。
	 * @param {Function} action 要执行的异步动作。
	 * @returns {Promise<any>} 动作的结果。
	 */
	async runBusyAction(action) {
		this.markBusy()
		return await this.runAction(action)
	}

	/**
	 * 检查系统当前是否空闲。
	 * @returns {boolean} 如果系统空闲则为 true，否则为 false。
	 */
	isIdle() {
		return !this.#runningActions && (Date.now() - this.#lastBusyTime) > this.#config.timeout
	}

	/**
	 * 注册一个在系统每次变为空闲时执行的动作。
	 * @param {Function} action 在空闲时执行的动作。
	 * @returns {void}
	 */
	onIdle(action) {
		this.#idleRuns.push(action)
	}

	/**
	 * 取消注册一个在空闲时执行的动作。
	 * @param {Function} action 曾通过 onIdle 注册的动作。
	 * @returns {void}
	 */
	offIdle(action) {
		const i = this.#idleRuns.indexOf(action)
		if (i !== -1) this.#idleRuns.splice(i, 1)
	}

	/**
	 * 注册一个仅在系统下一次变为空闲时执行的动作。
	 * @param {Function} action 在空闲时执行一次的动作。
	 * @returns {void}
	 */
	onIdleOnce(action) {
		this.#idleRunOnces.push(action)
	}

	/**
	 * 执行所有已注册的空闲动作。
	 * @private
	 * @returns {Promise<void>}
	 */
	async #runIdleTasks() {
		for (const action of this.#idleRuns) try {
			await action()
		} catch (e) {
			console.error('Idle action failed:', e)
		}
		for (const action of this.#idleRunOnces) try {
			await action()
		} catch (e) {
			console.error('Idle action failed:', e)
		}
		this.#idleRunOnces.length = 0 // 清除一次性动作
	}

	/**
	 * 检查空闲状态并运行任务的主循环。
	 * @private
	 * @returns {Promise<void>}
	 */
	async #idleRunner() {
		if (this.isIdle())
			await this.#runIdleTasks()
	}

	/**
	 * 开始定期检查空闲状态。
	 * @returns {void}
	 */
	start() {
		this.#stopped = false
		this.#timeoutId = setTimeout(async () => {
			this.#timeoutId = null
			await this.#idleRunner()
			if (!this.#stopped) this.start()
		}, this.#config.checkInterval)
	}

	/**
	 * 停止定期检查空闲状态。
	 * @returns {void}
	 */
	stop() {
		this.#stopped = true
		if (this.#timeoutId !== null) {
			clearTimeout(this.#timeoutId)
			this.#timeoutId = null
		}
	}

	/**
	 * 更新配置。
	 * @param {Partial<IdleManagerConfig>} newConfig 新的配置选项。
	 * @returns {void}
	 */
	setConfig(newConfig) {
		Object.assign(this.#config, newConfig)
	}
}

// 创建并导出一个单一的、全局的 IdleManager 实例。
const idleManager = new IdleManager()
/**
 * 一个单一的、全局的 IdleManager 实例。
 */
export default idleManager

const defaultConfig = {
	timeout: 30000, // 30 seconds
	checkInterval: 5 * 60 * 1000 // 5 minutes
};

export class IdleManager {
	#lastBusyTime;
	#runningActions = 0;
	#idleRuns = [];
	#idleRunOnces = [];
	#config;

	constructor(config = {}) {
		this.#config = { ...defaultConfig, ...config };
		this.#lastBusyTime = Date.now();
	}

	/**
	 * Marks the system as busy.
	 */
	markBusy() {
		this.#lastBusyTime = Date.now();
	}

	/**
	 * Wraps and executes an action, tracking its running state.
	 * @param {Function} action The async action to execute.
	 * @returns {Promise<any>} The result of the action.
	 */
	async runAction(action) {
		this.#runningActions++;
		try {
			return await action();
		} finally {
			this.#runningActions--;
		}
	}

	/**
	 * Marks the system as busy and then executes an action.
	 * @param {Function} action The async action to execute.
	 * @returns {Promise<any>} The result of the action.
	 */
	async runBusyAction(action) {
		this.markBusy();
		return await this.runAction(action);
	}

	/**
	 * Checks if the system is currently idle.
	 * @returns {boolean} True if the system is idle, false otherwise.
	 */
	isIdle() {
		return this.#runningActions === 0 && (Date.now() - this.#lastBusyTime) > this.#config.timeout;
	}

	/**
	 * Registers an action to be executed every time the system becomes idle.
	 * @param {Function} action The action to execute on idle.
	 */
	onIdle(action) {
		this.#idleRuns.push(action);
	}

	/**
	 * Registers an action to be executed only the next time the system becomes idle.
	 * @param {Function} action The action to execute once on idle.
	 */
	onIdleOnce(action) {
		this.#idleRunOnces.push(action);
	}

	/**
	 * Executes all registered idle actions.
	 * @private
	 */
	async #runIdleTasks() {
		for (const action of this.#idleRuns) try {
			await action();
		} catch (e) {
			console.error("Idle action failed:", e);
		}
		for (const action of this.#idleRunOnces) try {
			await action();
		} catch (e) {
			console.error("Idle action failed:", e);
		}
		this.#idleRunOnces.length = 0; // Clear the run-once actions
	}

	/**
	 * The main loop to check for idle state and run tasks.
	 * @private
	 */
	async #idleRunner() {
		if (this.isIdle()) {
			await this.#runIdleTasks();
		}
	}

	/**
	 * Starts the periodic check for the idle state.
	 */
	start() {
		setTimeout(async () => {
			await this.#idleRunner();
			this.start(); // Reschedule the next check
		}, this.#config.checkInterval);
	}

	/**
	 * Updates the configuration.
	 * @param {Partial<defaultConfig>} newConfig The new configuration options.
	 */
	setConfig(newConfig) {
		Object.assign(this.#config, newConfig);
	}
}

// Create and export a single, global instance of the IdleManager.
const idleManager = new IdleManager();
export default idleManager;

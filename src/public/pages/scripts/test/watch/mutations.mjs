/**
 * MutationObserver 闸门：语种轮换 / 临时隐藏文案时不喂 a11y dirty。
 */
export class MutationGate {
	#depth = 0
	/** @type {MutationObserver | null} */
	#observer = null

	/**
	 * @param {MutationObserver} observer DOM 观察者
	 * @returns {void}
	 */
	attach(observer) {
		this.#observer = observer
	}

	/**
	 * 是否正在忽略突变。
	 * @returns {boolean} ignoring
	 */
	get ignoring() {
		return this.#depth > 0
	}

	/**
	 * 同步忽略（pageText 隐藏 `[user-content]`）。
	 * @template T
	 * @param {() => T} fn 同步工作
	 * @returns {T} fn 的返回值
	 */
	runIgnored(fn) {
		this.#depth++
		try {
			return fn()
		}
		finally {
			this.#observer?.takeRecords()
			this.#depth--
		}
	}

	/**
	 * 异步忽略（setLanguage / 脚本检查）。
	 * @template T
	 * @param {() => T | Promise<T>} fn 可能改 DOM 的工作
	 * @returns {Promise<T>} fn 的返回值
	 */
	async withIgnored(fn) {
		this.#depth++
		try {
			return await fn()
		}
		finally {
			this.#observer?.takeRecords()
			this.#depth--
		}
	}
}

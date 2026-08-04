/**
 * MutationObserver 闸门：语种轮换 / 临时隐藏文案时不喂 a11y dirty。
 * 自持 observer；忽略期间 takeRecords 丢弃突变。
 */
export class MutationGate {
	#depth = 0
	/** @type {MutationObserver} */
	#observer
	/** @type {() => void} */
	#onMutate

	/**
	 * @param {() => void} onMutate 非忽略突变时的回调
	 */
	constructor(onMutate) {
		this.#onMutate = onMutate
		this.#observer = new MutationObserver(() => {
			if (this.#depth > 0) return
			this.#onMutate()
		})
	}

	/**
	 * 开始观察 DOM。
	 * @param {Node} target 观察根
	 * @param {MutationObserverInit} init 观察选项
	 * @returns {void}
	 */
	observe(target, init) {
		this.#observer.observe(target, init)
	}

	/**
	 * 同步忽略（pageText 隐藏 `[user-content]`）。
	 * @template T
	 * @param {() => T} fn 同步工作
	 * @returns {T} fn 的返回值
	 */
	ignore(fn) {
		this.#depth++
		try {
			return fn()
		}
		finally {
			this.#observer.takeRecords()
			this.#depth--
		}
	}

	/**
	 * 异步忽略（setLanguage / 脚本检查）。
	 * @template T
	 * @param {() => T | Promise<T>} fn 可能改 DOM 的工作
	 * @returns {Promise<T>} fn 的返回值
	 */
	async ignoreAsync(fn) {
		this.#depth++
		try {
			return await fn()
		}
		finally {
			this.#observer.takeRecords()
			this.#depth--
		}
	}
}

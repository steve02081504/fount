/**
 * 测试环境页面监视入口：组装 loop + a11y + locale，bootstrap 后开闸。
 * Playwright 只认 `fount.test.watch`（`kick` / `drain` / `holdLocale` / `releaseLocale` / `started`）。
 */
import { A11yWatch } from './a11y.mjs'
import { LocaleWatch } from './locale.mjs'
import { WatchLoop } from './loop.mjs'
import { MutationGate } from './mutations.mjs'
import { createReporter } from './reporter.mjs'

globalThis.fount ??= {}
globalThis.fount.test ??= {}

/**
 * 页面监视门面：供 Playwright `page.evaluate` 调用。
 */
class PageWatch {
	#localeHold = 0
	/** @type {WatchLoop} */
	#loop
	/** @type {A11yWatch} */
	#a11y
	/** @type {LocaleWatch} */
	#locale

	/** 组装 loop / a11y / locale 与 MutationObserver。 */
	constructor() {
		this.#loop = new WatchLoop({ reporter: createReporter('[test:watch]') })
		this.#a11y = new A11yWatch({
			reporter: createReporter('[test:a11y]'),
			/** @returns {void} */
			wake: () => this.#loop.wake(),
		})
		const mutations = new MutationGate(() => this.#a11y.markDirty())
		this.#locale = new LocaleWatch({
			reporter: createReporter('[test:locale]'),
			mutations,
			/** @returns {boolean} 是否已 hold */
			isHeld: () => this.#localeHold > 0,
		})
		this.#loop.register(this.#a11y)
		this.#loop.register(this.#locale)

		mutations.observe(document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
	}

	/**
	 * 是否已开闸（locale bootstrap 完成且 loop 已 start）。
	 * @returns {boolean} started
	 */
	get started() {
		return this.#loop.started
	}

	/**
	 * 立刻要求一轮带 issue 刷新的 a11y，并等到扫完。
	 * @returns {Promise<void>}
	 */
	kick() {
		if (!this.#loop.started) return Promise.resolve()
		return this.#a11y.requestRefresh()
	}

	/**
	 * Drain 到各任务 covered（三语 + 一轮带刷新 a11y）。
	 * @returns {Promise<void>}
	 */
	drain() {
		return this.#loop.drain()
	}

	/**
	 * 暂停语种轮换（引用计数）。
	 * @returns {void}
	 */
	holdLocale() {
		this.#localeHold++
	}

	/**
	 * 恢复语种轮换（引用计数）。
	 * @returns {void}
	 */
	releaseLocale() {
		this.#localeHold = Math.max(0, this.#localeHold - 1)
	}

	/**
	 * bootstrap locale 后开闸。
	 * @returns {Promise<void>}
	 */
	async start() {
		try {
			await this.#locale.bootstrap()
		}
		catch { /* i18n 不可用仍开闸 */ }
		this.#loop.start()
		await this.kick()
	}
}

const watch = new PageWatch()
globalThis.fount.test.watch = watch
void watch.start()

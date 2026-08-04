/**
 * 测试环境页面监视入口：组装 loop + a11y + locale，开闸后自动跑。
 * Playwright 只认 `fount.test.watch`（`kick` / `drain` / `lastRun` / `ready`）。
 */
import { A11yWatch } from './a11y.mjs'
import { LocaleWatch } from './locale.mjs'
import { MutationGate } from './mutations.mjs'
import { WatchLoop } from './watch_loop.mjs'

globalThis.fount ??= {}
globalThis.fount.test ??= {}

/**
 * 页面监视门面：供 Playwright `page.evaluate` 调用。
 */
class PageWatch {
	/** 最近一次非空转 tick 的时间戳（毫秒） */
	lastRun = 0

	#ready = false
	/** @type {MutationGate} */
	#mutations
	/** @type {WatchLoop} */
	#loop
	/** @type {A11yWatch} */
	#a11y
	/** @type {LocaleWatch} */
	#locale

	/** 组装 loop / a11y / locale 与 MutationObserver。 */
	constructor() {
		/** @type {Set<string>} */
		const printedKeys = new Set()
		this.#mutations = new MutationGate()
		this.#loop = new WatchLoop({
			failPrefix: '[test:a11y]',
			/** @returns {void} */
			onActivity: () => { this.lastRun = Date.now() },
		})
		this.#a11y = new A11yWatch({
			printedKeys,
			/** @returns {boolean} 是否已开闸 */
			isReady: () => this.#ready,
			/** @returns {void} */
			wake: () => this.#loop.wake(),
		})
		this.#locale = new LocaleWatch({
			printedKeys,
			mutations: this.#mutations,
			/** @returns {boolean} 是否已开闸 */
			isReady: () => this.#ready,
		})
		this.#loop.register(this.#a11y.createTask())
		this.#loop.register(this.#locale.createTask())

		const observer = new MutationObserver(() => this.#onDomMutate())
		this.#mutations.attach(observer)
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
	}

	/**
	 * 是否已开闸。
	 * @returns {boolean} 开闸则为 true
	 */
	get ready() {
		return this.#ready
	}

	/**
	 * 立刻要求一轮带 issue 刷新的 a11y。
	 * @returns {void}
	 */
	kick() {
		if (!this.#ready) return
		this.#a11y.requestRefresh()
	}

	/**
	 * Drain 到各任务 covered（三语 + 一轮带刷新 a11y）。
	 * @returns {Promise<void>}
	 */
	async drain() {
		if (!this.#ready) return
		await this.#loop.drain()
	}

	/**
	 * 开闸并启动监视。
	 * @returns {void}
	 */
	open() {
		if (this.#ready) return
		this.#ready = true
		this.#locale.preloadJaForbidden()
		this.kick()
	}

	/**
	 * 按首选语言对齐轮换下标。
	 * @param {string} preferred 首选 BCP 47
	 * @param {(preferred: string[], available: string[]) => string | undefined} matchLocale i18n.matchLocale
	 * @returns {void}
	 */
	alignLocale(preferred, matchLocale) {
		this.#locale.alignIndex(preferred, matchLocale)
	}

	/**
	 * DOM 变更时标脏并唤醒。
	 * @returns {void}
	 */
	#onDomMutate() {
		if (this.#mutations.ignoring) return
		this.#a11y.markDirty({ wake: this.#ready })
	}
}

const watch = new PageWatch()
globalThis.fount.test.watch = watch

if (!document.querySelector('[data-i18n]')) watch.open()
else import('../../i18n/index.mjs').then(({ onLanguageChange, offLanguageChange, loadPreferredLangs, matchLocale }) => {
	const preferred = loadPreferredLangs()[0]
	if (preferred) watch.alignLocale(preferred, matchLocale)
	/**
	 * 首轮语言落定后开闸。
	 * @returns {void}
	 */
	function onLocale() {
		// register 时会同步先跑一次；尚未 applyTranslations 则留下回调等真正变更
		if (!document.documentElement.lang) return
		offLanguageChange(onLocale)
		watch.open()
	}
	onLanguageChange(onLocale)
}).catch(() => watch.open())

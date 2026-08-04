/**
 * 中日英语种轮换 + 错语脚本检查。
 */

const LOCALE_PREFIX = '[test:locale]'
/** 中日英轮换间隔 */
export const LOCALE_MS = 1000

/** 轮换顺序 */
export const LOCALE_CYCLE = ['zh-CN', 'ja-JP', 'en-UK']

/**
 * 英语：不得出现汉字 / 假名
 * 中文：不得出现平假名 / 片假名
 * （简体相对日语：Unicode 无 `\p{Hans}`，见 jaForbidden 运行时差分）
 */
const SCRIPT_FORBIDDEN = {
	'en-UK': /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
	'zh-CN': /\p{Script=Hiragana}|\p{Script=Katakana}/u,
}

/**
 * locale watch 任务。
 */
export class LocaleWatch {
	/** @type {Set<string>} */
	#seen = new Set()
	#index = 0
	/** @type {Set<string>} */
	#printedKeys
	/** @type {import('./mutations.mjs').MutationGate} */
	#mutations
	/** @type {() => boolean} */
	#isReady
	/** @type {RegExp | null | undefined} */
	#jaForbiddenRe
	/** @type {Promise<RegExp | null> | null} */
	#jaForbiddenLoading = null

	/**
	 * @param {object} options 依赖
	 * @param {Set<string>} options.printedKeys 违规指纹去重
	 * @param {import('./mutations.mjs').MutationGate} options.mutations 突变闸门
	 * @param {() => boolean} options.isReady locale 闸是否已开
	 */
	constructor({ printedKeys, mutations, isReady }) {
		this.#printedKeys = printedKeys
		this.#mutations = mutations
		this.#isReady = isReady
	}

	/**
	 * 已检查过的语种（暴露给 fount.test.localeSeen）。
	 * @returns {Set<string>} seen
	 */
	get localeSeen() {
		return this.#seen
	}

	/**
	 * 注册到 WatchLoop 的任务描述。
	 * @returns {import('./watch_loop.mjs').WatchTask} 任务
	 */
	createTask() {
		return {
			name: 'locale',
			delayMs: LOCALE_MS,
			run: this.runTask.bind(this),
			covered: this.isCovered.bind(this),
		}
	}

	/**
	 * WatchLoop 回调：切语种或空转。
	 * @param {import('./watch_loop.mjs').WatchTickContext} ctx tick 上下文
	 * @returns {Promise<boolean>} true = 空转
	 */
	runTask(ctx) {
		return this.#run(ctx)
	}

	/**
	 * 三语脚本检查是否都跑过。
	 * @returns {boolean} 全部 seen 则为 true
	 */
	isCovered() {
		return LOCALE_CYCLE.every(locale => this.#seen.has(locale))
	}

	/**
	 * 按首选语言对齐轮换下标。
	 * @param {string} preferred 首选 BCP 47
	 * @param {(preferred: string[], available: string[]) => string | undefined} matchLocale i18n.matchLocale
	 * @returns {void}
	 */
	alignIndex(preferred, matchLocale) {
		const matched = matchLocale([preferred], LOCALE_CYCLE)
		if (matched) this.#index = LOCALE_CYCLE.indexOf(matched)
	}

	/**
	 * 预热简体相对日语的禁止汉字差分。
	 * @returns {Promise<RegExp | null>} 禁止汉字正则；无差分则为 null
	 */
	preloadJaForbidden() {
		return this.#loadJaForbiddenRe()
	}

	/**
	 * Playwright 是否暂停语种轮换。
	 * @returns {boolean} 已 hold 则为 true
	 */
	#isHeld() {
		return (globalThis.fount.test.localeHold || 0) > 0
	}

	/**
	 * @param {import('./watch_loop.mjs').WatchTickContext} ctx tick 上下文
	 * @returns {Promise<boolean>} true = 空转
	 */
	async #run({ draining }) {
		if (!this.#isReady()) return true
		if (this.#isHeld() && !draining) return true
		const i18n = await import('../../i18n/index.mjs')
		if (draining) {
			const next = LOCALE_CYCLE.find(locale => !this.#seen.has(locale))
			if (!next) return true
			await this.#mutations.withIgnored(async () => {
				await i18n.setLanguage([next])
				this.#index = LOCALE_CYCLE.indexOf(next)
				await this.#scriptCheck(next)
			})
			return false
		}
		const current = i18n.main_locale || i18n.loadPreferredLangs()[0] || 'zh-CN'
		const matched = i18n.matchLocale([current], LOCALE_CYCLE)
		if (matched && !this.#seen.has(matched)) {
			await this.#mutations.withIgnored(() => this.#scriptCheck(matched))
			return false
		}
		this.#index = (this.#index + 1) % LOCALE_CYCLE.length
		const next = LOCALE_CYCLE[this.#index]
		await this.#mutations.withIgnored(async () => {
			await i18n.setLanguage([next])
			await this.#scriptCheck(next)
		})
		return false
	}

	/**
	 * @returns {string} 可见 UI 文案（含 title）；跳过 `[user-content]`
	 */
	#pageText() {
		return this.#mutations.runIgnored(() => {
			const skipped = [...document.querySelectorAll('[user-content]')]
			/** @type {string[]} */
			const prevDisplay = []
			for (const el of skipped) {
				prevDisplay.push(el.style.getPropertyValue('display'))
				el.style.setProperty('display', 'none', 'important')
			}
			try {
				return `${document.title}\n${document.body?.innerText ?? ''}`
			}
			finally {
				skipped.forEach((el, i) => {
					if (prevDisplay[i]) el.style.setProperty('display', prevDisplay[i])
					else el.style.removeProperty('display')
				})
			}
		})
	}

	/**
	 * @param {unknown} value JSON 值
	 * @param {Set<string>} [out] 输出集
	 * @returns {Set<string>} 汉字集合
	 */
	#collectHanChars(value, out = new Set()) {
		if (typeof value === 'string') {
			for (const ch of value)
				if (/\p{Script=Han}/u.test(ch)) out.add(ch)
			return out
		}
		if (value && typeof value === 'object')
			for (const child of Object.values(value)) this.#collectHanChars(child, out)
		return out
	}

	/**
	 * 加载简体相对日语的禁止汉字正则。
	 * @returns {Promise<RegExp | null>} 禁止正则；无差分则为 null
	 */
	#loadJaForbiddenRe() {
		if (this.#jaForbiddenRe !== undefined) return Promise.resolve(this.#jaForbiddenRe)
		if (this.#jaForbiddenLoading) return this.#jaForbiddenLoading
		this.#jaForbiddenLoading = (async () => {
			const { loadLocaleData } = await import('../../i18n/index.mjs')
			const [zh, ja] = await Promise.all([
				loadLocaleData(['zh-CN']),
				loadLocaleData(['ja-JP']),
			])
			const jaHan = this.#collectHanChars(ja)
			const zhOnly = [...this.#collectHanChars(zh)].filter(ch => !jaHan.has(ch))
			this.#jaForbiddenRe = zhOnly.length
				? new RegExp(`[${zhOnly.map(ch => ch.replace(/[\\\]^-]/gu, '\\$&')).join('')}]`, 'u')
				: null
			return this.#jaForbiddenRe
		})().catch(error => {
			this.#jaForbiddenLoading = null
			console.error(LOCALE_PREFIX, 'ja-forbidden-load-failed', String(error?.message || error))
			this.#jaForbiddenRe = null
			return null
		})
		return this.#jaForbiddenLoading
	}

	/**
	 * 该语种下禁止出现的字符正则。
	 * @param {string} locale 当前主 locale
	 * @returns {Promise<RegExp | null | undefined>} 禁止正则
	 */
	async #forbiddenReFor(locale) {
		if (locale === 'ja-JP' || locale.startsWith('ja')) return this.#loadJaForbiddenRe()
		if (locale.startsWith('en')) return SCRIPT_FORBIDDEN['en-UK']
		if (locale.startsWith('zh')) return SCRIPT_FORBIDDEN['zh-CN']
		return SCRIPT_FORBIDDEN[locale]
	}

	/**
	 * 对各任务执行脚本检查并记入 seen。
	 * @param {string} locale 当前主 locale
	 * @returns {Promise<void>} 检查完成
	 */
	async #scriptCheck(locale) {
		const re = await this.#forbiddenReFor(locale)
		this.#seen.add(locale)
		if (!re) return
		const text = this.#pageText()
		const match = text.match(re)
		if (match) {
			const key = `locale\t${locale}\t${match[0]}`
			if (!this.#printedKeys.has(key)) {
				this.#printedKeys.add(key)
				const at = Math.max(0, match.index - 12)
				const snippet = text.slice(at, at + 32).replace(/\s+/g, ' ')
				console.error(LOCALE_PREFIX, locale, 'forbidden-script', match[0], snippet)
			}
		}
	}
}

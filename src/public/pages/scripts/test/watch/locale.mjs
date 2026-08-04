/**
 * 中日英语种轮换 + 错语脚本检查。
 */
import { collectVisiblePageText } from './page_text.mjs'

/** 中日英轮换间隔 */
const LOCALE_MS = 1000

/** 轮换顺序 */
const LOCALE_CYCLE = ['zh-CN', 'ja-JP', 'en-UK']

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
 * locale watch 任务：直接实现 WatchTask。
 */
export class LocaleWatch {
	name = 'locale'
	delayMs = LOCALE_MS

	/** @type {Set<string>} */
	#seen = new Set()
	#index = 0
	/** @type {import('./reporter.mjs').WatchReporter} */
	#reporter
	/** @type {import('./mutations.mjs').MutationGate} */
	#mutations
	/** @type {() => boolean} */
	#isHeld
	/** @type {RegExp | null | undefined} */
	#jaForbiddenRe
	/** @type {Promise<RegExp | null> | null} */
	#jaForbiddenLoading = null
	/** @type {Promise<typeof import('../../i18n/index.mjs')> | null} */
	#i18nModule = null

	/**
	 * @param {object} options 依赖
	 * @param {import('./reporter.mjs').WatchReporter} options.reporter 去重上报
	 * @param {import('./mutations.mjs').MutationGate} options.mutations 突变闸门
	 * @param {() => boolean} options.isHeld 是否暂停语种轮换
	 */
	constructor({ reporter, mutations, isHeld }) {
		this.#reporter = reporter
		this.#mutations = mutations
		this.#isHeld = isHeld
	}

	/**
	 * 三语脚本检查是否都跑过。
	 * @returns {boolean} 全部 seen 则为 true
	 */
	covered() {
		return LOCALE_CYCLE.every(locale => this.#seen.has(locale))
	}

	/**
	 * 预热简体相对日语的禁止汉字差分，并对齐首选语言，等首轮 lang 落定。
	 * @returns {Promise<void>}
	 */
	async bootstrap() {
		void this.#loadJaForbiddenRe()
		const i18n = await this.#i18n()
		if (!document.querySelector('[data-i18n]')) return

		const preferred = i18n.loadPreferredLangs()[0]
		if (preferred) {
			const matched = i18n.matchLocale([preferred], LOCALE_CYCLE)
			if (matched) this.#index = LOCALE_CYCLE.indexOf(matched)
		}

		if (document.documentElement.lang) return

		await new Promise(resolve => {
			/**
			 * 首轮语言落定后继续。
			 * @returns {void}
			 */
			function onLocale() {
				if (!document.documentElement.lang) return
				i18n.offLanguageChange(onLocale)
				resolve()
			}
			i18n.onLanguageChange(onLocale)
		})
	}

	/**
	 * WatchLoop 回调：切语种或空转。
	 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
	 * @returns {Promise<boolean>} true = 空转
	 */
	async run({ draining }) {
		if (this.#isHeld() && !draining) return true
		const i18n = await this.#i18n()
		if (draining) {
			const next = LOCALE_CYCLE.find(locale => !this.#seen.has(locale))
			if (!next) return true
			await this.#mutations.ignoreAsync(async () => {
				await i18n.setLanguage([next])
				this.#index = LOCALE_CYCLE.indexOf(next)
				await this.#scriptCheck(next)
			})
			return false
		}
		const current = i18n.main_locale || i18n.loadPreferredLangs()[0] || 'zh-CN'
		const matched = i18n.matchLocale([current], LOCALE_CYCLE)
		if (matched && !this.#seen.has(matched)) {
			await this.#mutations.ignoreAsync(() => this.#scriptCheck(matched))
			return false
		}
		this.#index = (this.#index + 1) % LOCALE_CYCLE.length
		const next = LOCALE_CYCLE[this.#index]
		await this.#mutations.ignoreAsync(async () => {
			await i18n.setLanguage([next])
			await this.#scriptCheck(next)
		})
		return false
	}

	/**
	 * @returns {Promise<typeof import('../../i18n/index.mjs')>} i18n 模块
	 */
	#i18n() {
		this.#i18nModule ??= import('../../i18n/index.mjs')
		return this.#i18nModule
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
			const { loadLocaleData } = await this.#i18n()
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
			this.#reporter.report(
				`ja-forbidden-load-failed\t${String(error?.message || error)}`,
				'ja-forbidden-load-failed',
				String(error?.message || error),
			)
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
		const i18n = await this.#i18n()
		if (i18n.matchLocale([locale], ['ja-JP'])) return this.#loadJaForbiddenRe()
		const matched = i18n.matchLocale([locale], Object.keys(SCRIPT_FORBIDDEN))
		return matched ? SCRIPT_FORBIDDEN[matched] : undefined
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
		const text = this.#mutations.ignore(() => collectVisiblePageText())
		const match = text.match(re)
		if (match) {
			const at = Math.max(0, match.index - 12)
			const snippet = text.slice(at, at + 32).replace(/\s+/g, ' ')
			this.#reporter.report(
				`locale\t${locale}\t${match[0]}`,
				locale,
				'forbidden-script',
				match[0],
				snippet,
			)
		}
	}
}

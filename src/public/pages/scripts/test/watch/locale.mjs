/**
 * 中日英语种轮换 + 错语脚本检查（可见文案 + aria-label）。
 */
import { isLocaleHeld } from './locale_hold.mjs'
import {
	SCRIPT_FORBIDDEN,
	ariaLabelLocaleProblem,
	collectAriaLabelsForLocaleCheck,
} from './locale_script.mjs'
import { ignore, ignoreAsync } from './mutations.mjs'
import { collectVisiblePageText } from './page_text.mjs'
import { createReporter } from './reporter.mjs'

/** 中日英轮换间隔 */
const LOCALE_MS = 1000

/** 轮换顺序 */
const LOCALE_CYCLE = ['zh-CN', 'ja-JP', 'en-UK']

const reporter = createReporter('[test:locale]')

/** @type {Set<string>} */
const seen = new Set()
let index = 0
/** @type {RegExp | null | undefined} */
let jaForbiddenRe
/** @type {Promise<RegExp | null> | null} */
let jaForbiddenLoading = null
/** @type {Promise<typeof import('../../i18n/index.mjs')> | null} */
let i18nModule = null

/** @returns {boolean} 无 data-i18n 则为无 UI 文案页 */
const isTextlessPage = () => !document.querySelector('[data-i18n]')

/**
 * 三语脚本检查是否都跑过。
 * @returns {boolean} 全部 seen 则为 true
 */
function covered() {
	return isTextlessPage() || LOCALE_CYCLE.every(locale => seen.has(locale))
}

/**
 * 预热简体相对日语的禁止汉字差分，并对齐首选语言，等首轮 lang 落定。
 * @returns {Promise<void>}
 */
export async function bootstrap() {
	if (isTextlessPage()) return
	void loadJaForbiddenRe()
	const i18n = await getI18n()

	const preferred = i18n.loadPreferredLangs()[0]
	if (preferred) {
		const matched = i18n.matchLocale([preferred], LOCALE_CYCLE)
		if (matched) index = LOCALE_CYCLE.indexOf(matched)
	}

	if (document.documentElement.lang) return

	await new Promise((resolve, reject) => {
		/**
		 * 首轮语言落定后继续。
		 * @returns {void}
		 */
		function onLocale() {
			if (!document.documentElement.lang) return
			cleanup()
			resolve()
		}
		/**
		 * 移除监听与超时。
		 * @returns {void}
		 */
		function cleanup() {
			clearTimeout(timer)
			i18n.offLanguageChange(onLocale)
		}
		const timer = setTimeout(() => {
			cleanup()
			reject(new Error('locale bootstrap timed out waiting for document.documentElement.lang'))
		}, 10_000)
		i18n.onLanguageChange(onLocale)
	})
}

/**
 * loop 回调：切语种或空转。
 * @param {import('./loop.mjs').WatchTickContext} ctx tick 上下文
 * @returns {Promise<boolean>} true = 空转
 */
async function run({ draining }) {
	if (isTextlessPage()) return true
	if (isLocaleHeld() && !draining) return true
	const i18n = await getI18n()
	if (draining) {
		const next = LOCALE_CYCLE.find(locale => !seen.has(locale))
		if (!next) return true
		await ignoreAsync(async () => {
			await i18n.setLanguage([next])
			index = LOCALE_CYCLE.indexOf(next)
			await scriptCheck(next)
		})
		return false
	}
	const current = i18n.main_locale || i18n.loadPreferredLangs()[0] || 'zh-CN'
	const matched = i18n.matchLocale([current], LOCALE_CYCLE)
	if (matched && !seen.has(matched)) {
		await ignoreAsync(() => scriptCheck(matched))
		return false
	}
	index = (index + 1) % LOCALE_CYCLE.length
	const next = LOCALE_CYCLE[index]
	await ignoreAsync(async () => {
		await i18n.setLanguage([next])
		await scriptCheck(next)
	})
	return false
}

/**
 * @returns {Promise<typeof import('../../i18n/index.mjs')>} i18n 模块
 */
function getI18n() {
	i18nModule ??= import('../../i18n/index.mjs')
	return i18nModule
}

/**
 * @param {unknown} value JSON 值
 * @param {Set<string>} [out] 输出集
 * @returns {Set<string>} 汉字集合
 */
function collectHanChars(value, out = new Set()) {
	if (typeof value === 'string') {
		for (const ch of value)
			if (/\p{Script=Han}/u.test(ch)) out.add(ch)
		return out
	}
	if (value && typeof value === 'object')
		for (const child of Object.values(value)) collectHanChars(child, out)
	return out
}

/**
 * 加载简体相对日语的禁止汉字正则。
 * @returns {Promise<RegExp | null>} 禁止正则；无差分则为 null
 */
function loadJaForbiddenRe() {
	if (jaForbiddenRe !== undefined) return Promise.resolve(jaForbiddenRe)
	if (jaForbiddenLoading) return jaForbiddenLoading
	jaForbiddenLoading = (async () => {
		const { loadLocaleData } = await getI18n()
		const [zh, ja] = await Promise.all([
			loadLocaleData(['zh-CN']),
			loadLocaleData(['ja-JP']),
		])
		const jaHan = collectHanChars(ja)
		const zhOnly = [...collectHanChars(zh)].filter(ch => !jaHan.has(ch))
		jaForbiddenRe = zhOnly.length
			? new RegExp(`[${zhOnly.map(ch => ch.replace(/[\\\]^-]/gu, '\\$&')).join('')}]`, 'u')
			: null
		return jaForbiddenRe
	})().catch(error => {
		jaForbiddenLoading = null
		reporter.report(
			`ja-forbidden-load-failed\t${String(error?.message || error)}`,
			'ja-forbidden-load-failed',
			String(error?.message || error),
		)
		jaForbiddenRe = null
		return null
	})
	return jaForbiddenLoading
}

/**
 * 该语种下禁止出现的字符正则（可见文案）。
 * @param {string} locale 当前主 locale
 * @returns {Promise<RegExp | null | undefined>} 禁止正则
 */
async function forbiddenReFor(locale) {
	const i18n = await getI18n()
	if (i18n.matchLocale([locale], ['ja-JP'])) return loadJaForbiddenRe()
	const matched = i18n.matchLocale([locale], Object.keys(SCRIPT_FORBIDDEN))
	return matched ? SCRIPT_FORBIDDEN[matched] : undefined
}

/**
 * @param {string} locale 当前主 locale
 * @returns {Promise<string | null>} zh-CN / ja-JP / en-UK 或 null
 */
async function normalizeCycleLocale(locale) {
	const i18n = await getI18n()
	return i18n.matchLocale([locale], LOCALE_CYCLE) || null
}

/**
 * 对各任务执行脚本检查并记入 seen。
 * @param {string} locale 当前主 locale
 * @returns {Promise<void>} 检查完成
 */
async function scriptCheck(locale) {
	const re = await forbiddenReFor(locale)
	const localeNorm = await normalizeCycleLocale(locale)
	seen.add(locale)
	if (re) {
		const text = ignore(() => collectVisiblePageText())
		const match = text.match(re)
		if (match) {
			const at = Math.max(0, match.index - 12)
			const snippet = text.slice(at, at + 32).replace(/\s+/g, ' ')
			reporter.report(
				`locale\t${locale}\t${match[0]}`,
				locale,
				'forbidden-script',
				match[0],
				snippet,
			)
		}
	}
	if (!localeNorm) return
	const jaForbidden = localeNorm === 'ja-JP' ? await loadJaForbiddenRe() : null
	for (const { label, where } of ignore(() => collectAriaLabelsForLocaleCheck())) {
		const problem = ariaLabelLocaleProblem(localeNorm, label, jaForbidden)
		if (!problem) continue
		reporter.report(
			`aria-label\t${localeNorm}\t${problem}\t${where}\t${label}`,
			localeNorm,
			'aria-label',
			problem,
			where,
			label,
		)
	}
}

/** @type {import('./loop.mjs').WatchTask} */
export const task = { name: 'locale', delayMs: LOCALE_MS, run, covered }

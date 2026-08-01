/**
 * 测试环境页面监视：import 即启动；导出 `ARIA_IGNORE` 供产品侧标记子树。
 * - axe-core 无障碍：真实 DOM 变脏时每 0.5s 扫，静止则停；命中即报
 * - `[aria-ignore="https://github.com/…/issues/n"]`：仅合法 issue URL 参与 axe `exclude`；
 *   缺省 / 非法格式在此报；关闭态经 `fount.test.hubUrl` → 测试 hub（成功结果与进行中请求按 URL 缓存，
 *   失败退避；`kickWatch` / `cycleLocales` 显式刷新），或 Playwright 收尾硬失败
 * - 语种轮换：每秒在 zh-CN / ja-JP / en-UK 间切换，并用 `\p{Script=…}` 查错语字符
 *   （轮换自身的 DOM 写入不计入 a11y dirty，否则扫描定时器永远停不下来）
 *
 * 本地化：有 `[data-i18n]` 时等 `onLanguageChange` 开闸并立刻 `offLanguageChange`；
 * 无本地化标记则立即开始。
 *
 * 违规以 `[test:a11y]` / `[test:locale]` 打到 console（指纹去重）；Playwright 捕获即硬失败。
 * 收尾可经 `fount.test.kickWatch()` / `cycleLocales()`（后者每语种立刻扫一轮 a11y）。
 *
 * 过渡态也须合规：未就绪区域用 `aria-hidden`/`inert`/`hidden`，文案原子写入；勿靠扫描侧吞报。
 */
import axe from 'https://esm.sh/axe-core'

import { parseGithubIssueUrl } from './github_issue.mjs'

/**
 * 第三方 / 暂不可修子树：axe `exclude`。
 * 属性值必须是跟踪上游修复的 GitHub issue URL（`aria-ignore="https://github.com/…/issues/n"`）。
 */
export const ARIA_IGNORE = 'aria-ignore'

/** hub 查询有界超时（毫秒）。 */
const GITHUB_ISSUE_FETCH_TIMEOUT_MS = 10_000
/** hub 失败后的退避（毫秒）。 */
const GITHUB_ISSUE_PROBE_BACKOFF_MS = 30_000

const A11Y_PREFIX = '[test:a11y]'
const LOCALE_PREFIX = '[test:locale]'
/** DOM 仍在变时的 a11y 扫描间隔 */
const SCAN_MS = 500
/** 中日英轮换间隔 */
const LOCALE_MS = 1000

/** 轮换顺序 */
const LOCALE_CYCLE = ['zh-CN', 'ja-JP', 'en-UK']

/**
 * 英语：不得出现汉字 / 假名
 * 中文：不得出现平假名 / 片假名
 * （简体相对日语：Unicode 无 `\p{Hans}`，见 `jaForbiddenRe` 运行时差分）
 */
const SCRIPT_FORBIDDEN = {
	'en-UK': /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
	'zh-CN': /\p{Script=Hiragana}|\p{Script=Katakana}/u,
}

globalThis.fount ??= {}
globalThis.fount.test ??= {}
if (globalThis.fount.test.watchStarted) throw new Error('test_watch imported twice')
globalThis.fount.test.watchStarted = true

/** @type {Set<string>} */
const printedKeys = new Set()
/** @type {Set<string>} */
const localeSeen = new Set()
globalThis.fount.test.localeSeen = localeSeen

let localeReady = false
let scanTimer = 0
let localeTimer = 0
let localeIndex = 0
/** 自上次扫描以来 DOM 是否又变过 */
let dirty = false
/** >0 时 MutationObserver 不记 dirty（语种轮换 / pageText 临时隐藏） */
let ignoreMutations = 0
/** 串行化 axe + locale I/O，避免重叠 */
let watchChain = Promise.resolve()
/** @type {RegExp | null | undefined} */
let jaForbiddenRe
/** @type {Promise<RegExp | null> | null} */
let jaForbiddenLoading = null

/** @type {Map<string, boolean>} */
const githubIssueClosedCache = new Map()
/** @type {Map<string, Promise<boolean>>} */
const githubIssueInflight = new Map()
/** @type {Map<string, number>} */
const githubIssueBackoffUntil = new Map()

/**
 * @typedef {{ url: string, location: string, element: Element, parsed: ReturnType<typeof parseGithubIssueUrl> }} AriaIgnoreEntry
 */

/**
 * 收集页面 `[aria-ignore]` 节点。
 * @returns {AriaIgnoreEntry[]} 各节点的 URL、位置与解析结果
 */
function collectAriaIgnoreEntries() {
	/** @type {AriaIgnoreEntry[]} */
	const entries = []
	for (const element of document.querySelectorAll(`[${ARIA_IGNORE}]`)) {
		const url = (element.getAttribute(ARIA_IGNORE) || '').trim()
		const location = element.id ? `#${element.id}` : element.className || element.tagName
		entries.push({
			url,
			location,
			element,
			parsed: url ? parseGithubIssueUrl(url) : null,
		})
	}
	return entries
}

/**
 * 清除 GitHub issue 关闭态探测缓存（供收尾显式刷新）。
 * @returns {void}
 */
function refreshGithubIssueProbes() {
	githubIssueClosedCache.clear()
	githubIssueBackoffUntil.clear()
	githubIssueInflight.clear()
}

/**
 * issue 是否已关闭（成功结果缓存；进行中请求复用；失败退避；无 hub / 超时 → false）。
 * @param {string} url 已解析的 issue URL
 * @param {{ refresh?: boolean }} [options] `refresh` 为 true 时跳过缓存并重新探测
 * @returns {Promise<boolean>} 已关闭为 true
 */
async function probeGithubIssueClosed(url, { refresh = false } = {}) {
	const hub = String(globalThis.fount?.test?.hubUrl || '').replace(/\/$/, '')
	if (!hub) return false

	if (refresh) {
		githubIssueClosedCache.delete(url)
		githubIssueBackoffUntil.delete(url)
		const inflight = githubIssueInflight.get(url)
		if (inflight) await inflight.catch(() => { })
		githubIssueInflight.delete(url)
	}
	else {
		if (githubIssueClosedCache.has(url)) return githubIssueClosedCache.get(url)
		if ((githubIssueBackoffUntil.get(url) ?? 0) > Date.now()) return false
		const inflight = githubIssueInflight.get(url)
		if (inflight) return inflight
	}

	const probe = (async () => {
		try {
			const response = await fetch(`${hub}/github-issue?url=${encodeURIComponent(url)}`, {
				signal: AbortSignal.timeout(GITHUB_ISSUE_FETCH_TIMEOUT_MS),
			})
			if (!response.ok) {
				githubIssueBackoffUntil.set(url, Date.now() + GITHUB_ISSUE_PROBE_BACKOFF_MS)
				return false
			}
			const closed = (await response.json())?.closed === true
			githubIssueClosedCache.set(url, closed)
			return closed
		}
		catch {
			githubIssueBackoffUntil.set(url, Date.now() + GITHUB_ISSUE_PROBE_BACKOFF_MS)
			return false
		}
		finally {
			githubIssueInflight.delete(url)
		}
	})()
	githubIssueInflight.set(url, probe)
	return probe
}

/**
 * Playwright 测体可设 `fount.test.localeHold > 0` 暂停轮换。
 * @returns {boolean} 是否暂停语种轮换
 */
function isLocaleHeld() {
	return (globalThis.fount.test.localeHold || 0) > 0
}

/**
 * @param {import('https://esm.sh/axe-core').Result} violation axe 违规
 * @param {import('https://esm.sh/axe-core').NodeResult} node 违规节点
 * @returns {string} 去重键
 */
function violationKey(violation, node) {
	const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target ?? '')
	return `${violation.id}\t${target}\t${node.failureSummary ?? ''}`
}

/**
 * 在 fn 期间产生的 DOM 突变不喂给 a11y dirty（finally 里 drain observer）。
 * @template T
 * @param {() => T | Promise<T>} fn 可能改 DOM 的工作
 * @returns {Promise<T>} fn 的返回值
 */
async function withIgnoredMutations(fn) {
	ignoreMutations++
	try {
		return await fn()
	}
	finally {
		domObserver.takeRecords()
		ignoreMutations--
	}
}

/**
 * 可见 UI 文案（含 title）；跳过 `[user-content]`。
 * @returns {string} 页面可见文本
 */
function pageText() {
	const skipped = [...document.querySelectorAll('[user-content]')]
	/** @type {string[]} */
	const prevDisplay = []
	ignoreMutations++
	try {
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
	}
	finally {
		domObserver.takeRecords()
		ignoreMutations--
	}
}

/**
 * 收集字符串树中的汉字。
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
 * 日语模式下禁止的「仅出现在简体文案里的汉字」（相对 ja-JP bundle 的差分，非手打表）。
 * @returns {Promise<RegExp | null>} 禁止汉字正则；无差分则为 null
 */
function loadJaForbiddenRe() {
	if (jaForbiddenRe !== undefined) return Promise.resolve(jaForbiddenRe)
	if (jaForbiddenLoading) return jaForbiddenLoading
	jaForbiddenLoading = (async () => {
		const { loadLocaleData } = await import('../i18n/index.mjs')
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
		console.error(LOCALE_PREFIX, 'ja-forbidden-load-failed', String(error?.message || error))
		jaForbiddenRe = null
		return null
	})
	return jaForbiddenLoading
}

/**
 * @param {string} locale 当前主 locale
 * @returns {Promise<RegExp | null | undefined>} 该语种下禁止出现的字符正则
 */
async function forbiddenReFor(locale) {
	if (locale === 'ja-JP' || locale.startsWith('ja')) return loadJaForbiddenRe()
	if (locale.startsWith('en')) return SCRIPT_FORBIDDEN['en-UK']
	if (locale.startsWith('zh')) return SCRIPT_FORBIDDEN['zh-CN']
	return SCRIPT_FORBIDDEN[locale]
}

/**
 * @param {string} locale 当前主 locale
 * @returns {Promise<void>}
 */
async function runLocaleScriptCheck(locale) {
	const re = await forbiddenReFor(locale)
	localeSeen.add(locale)
	if (!re) {
		globalThis.fount.test.watchLastRun = Date.now()
		return
	}
	const text = pageText()
	const match = text.match(re)
	if (match) {
		const key = `locale\t${locale}\t${match[0]}`
		if (!printedKeys.has(key)) {
			printedKeys.add(key)
			const at = Math.max(0, match.index - 12)
			const snippet = text.slice(at, at + 32).replace(/\s+/g, ' ')
			console.error(LOCALE_PREFIX, locale, 'forbidden-script', match[0], snippet)
		}
	}
	globalThis.fount.test.watchLastRun = Date.now()
}

/**
 * 校验 `[aria-ignore]`：缺 URL / 非法格式立刻报；有 hub 时额外查关闭态。
 * @param {{ refresh?: boolean, entries?: AriaIgnoreEntry[] }} [options] `refresh` 强制重查关闭态；`entries` 可复用已收集节点
 * @returns {Promise<void>} 完成校验
 */
async function checkAriaIgnores({ refresh = false, entries = collectAriaIgnoreEntries() } = {}) {
	const hub = String(globalThis.fount?.test?.hubUrl || '').replace(/\/$/, '')
	/** @type {{ url: string, location: string }[]} */
	const toProbe = []
	for (const { url, location, parsed } of entries) {
		if (!url) {
			const key = `aria-ignore-missing\t${location}`
			if (printedKeys.has(key)) continue
			printedKeys.add(key)
			console.error(A11Y_PREFIX, 'aria-ignore-missing-url', location, 'aria-ignore requires a GitHub issue URL')
			continue
		}
		if (!parsed) {
			const key = `aria-ignore-bad-url\t${url}`
			if (printedKeys.has(key)) continue
			printedKeys.add(key)
			console.error(A11Y_PREFIX, 'aria-ignore-bad-url', location, url)
			continue
		}
		if (hub) toProbe.push({ url, location })
	}
	if (!toProbe.length) return

	await Promise.all([...new Set(toProbe.map(item => item.url))].map(url =>
		probeGithubIssueClosed(url, { refresh }),
	))

	for (const { url, location } of toProbe) {
		if (githubIssueClosedCache.get(url) !== true) continue
		const key = `aria-ignore-closed\t${url}`
		if (printedKeys.has(key)) continue
		printedKeys.add(key)
		console.error(A11Y_PREFIX, 'aria-ignore-closed', location, url)
	}
}

/**
 * 跑一轮 axe 无障碍扫描。
 * @param {{ refreshGithubIssues?: boolean }} [options] `refreshGithubIssues` 为 true 时重查 issue 关闭态
 * @returns {Promise<void>} 完成扫描
 */
async function runA11y({ refreshGithubIssues = false } = {}) {
	if (!localeReady) return
	const ariaIgnoreEntries = collectAriaIgnoreEntries()
	await checkAriaIgnores({ refresh: refreshGithubIssues, entries: ariaIgnoreEntries })
	const axeExclude = ariaIgnoreEntries
		.filter(entry => entry.parsed)
		.map(entry => entry.element)
	const results = await axe.run({
		exclude: axeExclude,
	}, {
		resultTypes: ['violations'],
		iframes: false,
		// 对比度 / 仅靠颜色区分链接会逼改视觉层级，不纳入硬失败
		rules: {
			'color-contrast': { enabled: false },
			'link-in-text-block': { enabled: false },
		},
	})
	for (const violation of results.violations)
		for (const node of violation.nodes) {
			const key = violationKey(violation, node)
			if (printedKeys.has(key)) continue
			printedKeys.add(key)
			console.error(
				A11Y_PREFIX,
				violation.id,
				violation.help,
				node.target,
				node.failureSummary || '',
			)
		}

	globalThis.fount.test.watchLastRun = Date.now()
}

/**
 * 串行入队 watch 工作（axe / locale），避免重叠 `axe.run()`。
 * @template T
 * @param {() => T | Promise<T>} fn 工作函数
 * @returns {Promise<T>} fn 的返回值
 */
function enqueueWatch(fn) {
	const run = watchChain.then(() => fn())
	watchChain = run.catch(error => {
		console.error(A11Y_PREFIX, 'axe-run-failed', String(error?.message || error))
		globalThis.fount.test.watchLastRun = Date.now()
	})
	return run
}

/**
 * 入队一轮 a11y 扫描。
 * @param {{ refreshGithubIssues?: boolean }} [options] 传给 `runA11y`
 * @returns {void}
 */
function tickA11y(options = {}) {
	void enqueueWatch(() => runA11y(options))
}

/**
 * 切到下一语种并做脚本检查（不触发 a11y dirty）。
 * @returns {Promise<void>}
 */
async function advanceLocale() {
	if (isLocaleHeld()) return
	const i18n = await import('../i18n/index.mjs')
	localeIndex = (localeIndex + 1) % LOCALE_CYCLE.length
	const next = LOCALE_CYCLE[localeIndex]
	await withIgnoredMutations(async () => {
		await i18n.setLanguage([next])
		await runLocaleScriptCheck(i18n.main_locale || next)
	})
}

/**
 * 串行推进一轮语种（供定时器 / 收尾）。
 * @returns {void}
 */
function tickLocale() {
	watchChain = watchChain.then(() => advanceLocale()).catch(error => {
		console.error(LOCALE_PREFIX, 'rotate-failed', String(error?.message || error))
		globalThis.fount.test.watchLastRun = Date.now()
	})
}

/**
 * 保证有 a11y 扫描定时器；无 dirty 时自行停掉。
 * @returns {void}
 */
function ensureScanTimer() {
	if (scanTimer) return
	scanTimer = setInterval(() => {
		if (!dirty) {
			clearInterval(scanTimer)
			scanTimer = 0
			return
		}
		dirty = false
		tickA11y()
	}, SCAN_MS)
}

/**
 * 启动每秒语种轮换（只开一次）。
 * @returns {void}
 */
function ensureLocaleTimer() {
	if (localeTimer) return
	localeTimer = setInterval(tickLocale, LOCALE_MS)
}

/**
 * DOM 变脏：locale 已开闸则启动/保持 0.5s 扫描；否则只记 dirty，开闸时再扫。
 * @returns {void}
 */
function markDirty() {
	if (ignoreMutations) return
	dirty = true
	if (!localeReady) return
	ensureScanTimer()
}

/**
 * 立刻扫一轮 a11y + 当前语种脚本检查（供 Playwright 收尾确认）。
 * @returns {void}
 */
function kickWatch() {
	if (!localeReady) return
	dirty = true
	refreshGithubIssueProbes()
	tickA11y({ refreshGithubIssues: true })
	watchChain = watchChain.then(async () => {
		const i18n = await import('../i18n/index.mjs')
		const locale = i18n.main_locale || i18n.loadPreferredLangs()[0] || 'zh-CN'
		await withIgnoredMutations(() => runLocaleScriptCheck(locale))
	}).catch(error => {
		console.error(LOCALE_PREFIX, 'kick-failed', String(error?.message || error))
		globalThis.fount.test.watchLastRun = Date.now()
	})
	ensureScanTimer()
	ensureLocaleTimer()
}

/**
 * 强制跑完中日英三语各一次（短测 teardown 用，不依赖墙钟轮换）；
 * 每语种落定后立刻扫一轮 a11y，补上轮换不再喂 dirty 后的多语覆盖。
 * @returns {Promise<void>}
 */
async function cycleLocales() {
	if (!localeReady) return
	if (localeTimer) {
		clearInterval(localeTimer)
		localeTimer = 0
	}
	if (scanTimer) {
		clearInterval(scanTimer)
		scanTimer = 0
	}
	dirty = false
	const i18n = await import('../i18n/index.mjs')
	for (const locale of LOCALE_CYCLE)
		// 与 watchChain 串行：避免 axe / advanceLocale 与切语种重叠
		await enqueueWatch(async () => {
			await withIgnoredMutations(async () => {
				await i18n.setLanguage([locale])
				localeIndex = LOCALE_CYCLE.indexOf(locale)
				await runLocaleScriptCheck(i18n.main_locale || locale)
			})
			await runA11y({ refreshGithubIssues: true })
		}).catch(() => { })

	ensureLocaleTimer()
}

globalThis.fount.test.kickWatch = kickWatch
globalThis.fount.test.cycleLocales = cycleLocales
globalThis.fount.test.refreshGithubIssueProbes = refreshGithubIssueProbes

/**
 * @returns {void}
 */
function openLocaleGate() {
	if (localeReady) return
	localeReady = true
	// 预热简体差分；与首轮 kick 并行
	loadJaForbiddenRe()
	kickWatch()
}

const domObserver = new MutationObserver(markDirty)
domObserver.observe(document.documentElement, {
	subtree: true,
	childList: true,
	attributes: true,
	characterData: true,
})

if (!document.querySelector('[data-i18n]'))
	openLocaleGate()
else import('../i18n/index.mjs').then(({ onLanguageChange, offLanguageChange, loadPreferredLangs, matchLocale }) => {
	const preferred = loadPreferredLangs()[0]
	if (preferred) {
		const matched = matchLocale([preferred], LOCALE_CYCLE)
		if (matched) localeIndex = LOCALE_CYCLE.indexOf(matched)
	}
	/**
	 * @returns {void}
	 */
	function onLocale() {
		// register 时会同步先跑一次；尚未 applyTranslations 则留下回调等真正变更
		if (!document.documentElement.lang) return
		offLanguageChange(onLocale)
		openLocaleGate()
	}
	onLanguageChange(onLocale)
}).catch(openLocaleGate)

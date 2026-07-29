/**
 * 测试环境页面监视：import 即启动（无导出）。
 * - axe-core 无障碍：真实 DOM 变脏时每 0.5s 扫，静止则停；命中即报
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

const A11Y_PREFIX = '[test:a11y]'
const LOCALE_PREFIX = '[test:locale]'
/** DOM 仍在变时的 a11y 扫描间隔 */
const SCAN_MS = 500
/** 中日英轮换间隔 */
const LOCALE_MS = 1000

/** 轮换顺序 */
const LOCALE_CYCLE = Object.freeze(['zh-CN', 'ja-JP', 'en-UK'])

/**
 * 英语：不得出现汉字 / 假名
 * 中文：不得出现平假名 / 片假名
 * （简体相对日语：Unicode 无 `\p{Hans}`，见 `jaForbiddenRe` 运行时差分）
 */
const SCRIPT_FORBIDDEN = Object.freeze({
	'en-UK': /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u,
	'zh-CN': /\p{Script=Hiragana}|\p{Script=Katakana}/u,
})

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
 * @returns {Promise<void>}
 */
async function runA11y() {
	if (!localeReady) return
	const results = await axe.run(document, {
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
 * @returns {void}
 */
function tickA11y() {
	void enqueueWatch(() => runA11y())
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
	tickA11y()
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
	for (const locale of LOCALE_CYCLE) {
		await withIgnoredMutations(async () => {
			await i18n.setLanguage([locale])
			localeIndex = LOCALE_CYCLE.indexOf(locale)
			await runLocaleScriptCheck(i18n.main_locale || locale)
		})
		await enqueueWatch(() => runA11y())
	}
	ensureLocaleTimer()
}

globalThis.fount.test.kickWatch = kickWatch
globalThis.fount.test.cycleLocales = cycleLocales

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
else import('../i18n/index.mjs').then(({ onLanguageChange, offLanguageChange, loadPreferredLangs }) => {
	const preferred = loadPreferredLangs()[0]
	if (preferred) {
		const idx = LOCALE_CYCLE.indexOf(preferred)
		if (idx >= 0) localeIndex = idx
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

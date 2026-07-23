/**
 * 测试环境页面监视：import 即启动（无导出）。
 * 当前内置 axe-core 无障碍轮询；后续检查可继续挂在本模块。
 *
 * 本地化：有 `[data-i18n]` 时等 `onLanguageChange` 开闸并立刻 `offLanguageChange`；
 * 无本地化标记则立即开始。
 *
 * 违规以 `[test:a11y]` 打到 console（已打印指纹去重）；Playwright 捕获即硬失败。
 */
import axe from 'https://esm.sh/axe-core'

const A11Y_PREFIX = '[test:a11y]'
const INTERVAL_MS = 1000
/** 同一违规连续命中次数后才打印 */
const CONFIRM_HITS = 2

globalThis.fount ??= {}
globalThis.fount.test ??= {}
if (globalThis.fount.test.watchStarted) throw new Error('test_watch imported twice')
globalThis.fount.test.watchStarted = true

/** @type {Set<string>} */
const printedKeys = new Set()
/** @type {Map<string, number>} */
const pendingHits = new Map()

let localeReady = false
let timer = 0
/** 串行化 axe.run，避免 interval 重叠触发 “Axe is already running” */
let a11yChain = Promise.resolve()

/**
 * @param {import('https://esm.sh/axe-core').Result} violation
 * @param {import('https://esm.sh/axe-core').NodeResult} node
 * @returns {string}
 */
function violationKey(violation, node) {
	const target = Array.isArray(node.target) ? node.target.join(' ') : String(node.target ?? '')
	return `${violation.id}\t${target}\t${node.failureSummary ?? ''}`
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
	/** @type {Set<string>} */
	const seen = new Set()
	for (const violation of results.violations) {
		for (const node of violation.nodes) {
			const key = violationKey(violation, node)
			seen.add(key)
			if (printedKeys.has(key)) continue
			const hits = (pendingHits.get(key) || 0) + 1
			pendingHits.set(key, hits)
			if (hits < CONFIRM_HITS) continue
			printedKeys.add(key)
			pendingHits.delete(key)
			console.error(
				A11Y_PREFIX,
				violation.id,
				violation.help,
				node.target,
				node.failureSummary || '',
			)
		}
	}
	for (const key of pendingHits.keys())
		if (!seen.has(key)) pendingHits.delete(key)

	globalThis.fount.test.watchLastRun = Date.now()
}

/**
 * @returns {void}
 */
function tick() {
	a11yChain = a11yChain.then(() => runA11y()).catch(error => {
		console.error(A11Y_PREFIX, 'axe-run-failed', String(error?.message || error))
		globalThis.fount.test.watchLastRun = Date.now()
	})
}

/**
 * @returns {void}
 */
function openLocaleGate() {
	if (localeReady) return
	localeReady = true
	tick()
	if (!timer) timer = setInterval(tick, INTERVAL_MS)
}

if (!document.querySelector('[data-i18n]'))
	openLocaleGate()
else import('../i18n/index.mjs').then(({ onLanguageChange, offLanguageChange }) => {
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

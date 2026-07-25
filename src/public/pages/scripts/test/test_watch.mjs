/**
 * 测试环境页面监视：import 即启动（无导出）。
 * 当前内置 axe-core 无障碍检查；DOM 有变化时每 0.5s 扫一次，静止则停。
 *
 * 本地化：有 `[data-i18n]` 时等 `onLanguageChange` 开闸并立刻 `offLanguageChange`；
 * 无本地化标记则立即开始。
 *
 * 违规以 `[test:a11y]` 打到 console（已打印指纹去重）；Playwright 捕获即硬失败。
 * 收尾可经 `fount.test.kickWatch()` 立刻再扫（`waitForTestWatchCycle` 会调）。
 */
import axe from 'https://esm.sh/axe-core'

const A11Y_PREFIX = '[test:a11y]'
/** DOM 仍在变时的扫描间隔 */
const SCAN_MS = 500
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
let scanTimer = 0
/** 自上次扫描以来 DOM 是否又变过 */
let dirty = false
/** 串行化 axe.run，避免重叠触发 “Axe is already running” */
let a11yChain = Promise.resolve()

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
	for (const violation of results.violations) 
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
 * 保证有扫描定时器；无 dirty 且无待确认命中时自行停掉。
 * @returns {void}
 */
function ensureScanTimer() {
	if (scanTimer) return
	scanTimer = setInterval(() => {
		if (!dirty && !pendingHits.size) {
			clearInterval(scanTimer)
			scanTimer = 0
			return
		}
		dirty = false
		tick()
	}, SCAN_MS)
}

/**
 * DOM 变脏：locale 已开闸则启动/保持 0.5s 扫描；否则只记 dirty，开闸时再扫。
 * @returns {void}
 */
function markDirty() {
	dirty = true
	if (!localeReady) return
	ensureScanTimer()
}

/**
 * 立刻扫一轮并保持定时器（供 Playwright 收尾确认）。
 * @returns {void}
 */
function kickWatch() {
	if (!localeReady) return
	dirty = true
	tick()
	ensureScanTimer()
}

globalThis.fount.test.kickWatch = kickWatch

/**
 * @returns {void}
 */
function openLocaleGate() {
	if (localeReady) return
	localeReady = true
	kickWatch()
}

new MutationObserver(markDirty).observe(document.documentElement, {
	subtree: true,
	childList: true,
	attributes: true,
	characterData: true,
})

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

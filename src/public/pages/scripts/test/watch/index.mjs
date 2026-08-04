/**
 * 测试环境页面监视入口：组装 loop + a11y + locale，开闸后自动跑。
 */
import { A11yWatch } from './a11y.mjs'
import { LocaleWatch } from './locale.mjs'
import { MutationGate } from './mutations.mjs'
import { WatchLoop } from './watch_loop.mjs'


globalThis.fount ??= {}
globalThis.fount.test ??= {}
if (globalThis.fount.test.watchStarted) throw new Error('watch imported twice')
globalThis.fount.test.watchStarted = true

/** @type {Set<string>} */
const printedKeys = new Set()

const mutations = new MutationGate()
const loop = new WatchLoop({ failPrefix: '[test:a11y]' })

let localeReady = false

/**
 * locale 闸是否已开。
 * @returns {boolean} 已开则为 true
 */
function isLocaleReady() {
	return localeReady
}

/**
 * 唤醒 watch loop。
 * @returns {void}
 */
function wakeLoop() {
	loop.wake()
}

const a11y = new A11yWatch({
	printedKeys,
	isReady: isLocaleReady,
	wake: wakeLoop,
})

const locale = new LocaleWatch({
	printedKeys,
	mutations,
	isReady: isLocaleReady,
})

globalThis.fount.test.localeSeen = locale.localeSeen

loop.register(a11y.createTask())
loop.register(locale.createTask())

/**
 * DOM 变脏：未开闸只记脏位；开闸后唤醒 loop。
 * @returns {void}
 */
function onDomMutate() {
	if (mutations.ignoring) return
	a11y.markDirty({ wake: localeReady })
}

/**
 * 立刻要求一轮带 issue 刷新的 a11y。
 * @returns {void}
 */
function kickWatch() {
	if (!localeReady) return
	a11y.requestRefresh()
}

/**
 * Playwright 收尾：drain 到各任务 covered（三语 + 一轮带刷新 a11y）。
 * @returns {Promise<void>}
 */
async function cycleLocales() {
	if (!localeReady) return
	await loop.drain()
}

/**
 * 清除 GitHub issue 关闭态探测缓存。
 * @returns {void}
 */
function refreshGithubIssueProbes() {
	a11y.refreshGithubIssueProbes()
}

globalThis.fount.test.kickWatch = kickWatch
globalThis.fount.test.cycleLocales = cycleLocales
globalThis.fount.test.refreshGithubIssueProbes = refreshGithubIssueProbes

/**
 * 开闸并启动监视。
 * @returns {void}
 */
function openLocaleGate() {
	if (localeReady) return
	localeReady = true
	locale.preloadJaForbidden()
	kickWatch()
}

const domObserver = new MutationObserver(onDomMutate)
mutations.attach(domObserver)
domObserver.observe(document.documentElement, {
	subtree: true,
	childList: true,
	attributes: true,
	characterData: true,
})

if (!document.querySelector('[data-i18n]'))
	openLocaleGate()
else import('../../i18n/index.mjs').then(({ onLanguageChange, offLanguageChange, loadPreferredLangs, matchLocale }) => {
	const preferred = loadPreferredLangs()[0]
	if (preferred) locale.alignIndex(preferred, matchLocale)
	/**
	 * 首轮语言落定后开闸。
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

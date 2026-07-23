/**
 * 前端 Playwright 浏览器诊断：网络异常噪声行 + pageerror / test_watch / i18n missing 硬失败。
 */

/** 写入 suite 输出、供 `detectNoiseHits` 识别的前缀。 */
export const BROWSER_NETWORK_PREFIX = '[browser:network]'

/** `scripts/test/test_watch.mjs` 控制台命名空间；任意 `[test:…]` 命中则硬失败。 */
export const TEST_WATCH_CONSOLE_PREFIX = '[test:'

/** `scripts/i18n` 缺键警告前缀；命中则硬失败（不去重）。 */
export const I18N_MISSING_PREFIX = '[i18n:missing]'
/**
 * Chromium Opaque Response Blocking：跨源无 CORS 时掐掉响应；`<img>` 等展示往往仍正常，不当噪声。
 * @param {string | null | undefined} errorText Playwright `request.failure().errorText`
 * @returns {boolean} 是否应忽略
 */
export function isIgnoredBrowserNetworkError(errorText) {
	return Boolean(errorText?.includes('ERR_BLOCKED_BY_ORB'))
}

/**
 * @typedef {object} BrowserNetworkEntry
 * @property {'http' | 'requestfailed'} kind 诊断种类
 * @property {string} method HTTP 方法
 * @property {number | null} status HTTP 状态；requestfailed 为 null
 * @property {string} url 请求 URL
 * @property {string | null} error 失败文案；HTTP 4xx/5xx 为 null
 * @property {number} count 同类事件次数
 */

/**
 * 聚合键：同类请求合并计数，避免 heartbeat 等重复刷屏。
 * @param {Omit<BrowserNetworkEntry, 'count'>} entry 单条诊断
 * @returns {string} Map 键
 */
export function browserNetworkAggregateKey(entry) {
	return `${entry.kind}\t${entry.method}\t${entry.status ?? ''}\t${entry.url}\t${entry.error ?? ''}`
}

/**
 * 将一次网络异常记入聚合表。
 * @param {Map<string, BrowserNetworkEntry>} aggregates 聚合表
 * @param {Omit<BrowserNetworkEntry, 'count'>} entry 单条诊断
 * @returns {void}
 */
export function recordBrowserNetworkEntry(aggregates, entry) {
	const key = browserNetworkAggregateKey(entry)
	const existing = aggregates.get(key)
	if (existing) {
		existing.count += 1
		return
	}
	aggregates.set(key, { ...entry, count: 1 })
}

/**
 * 格式化为 suite 输出行（一行一条聚合）。
 * @param {BrowserNetworkEntry} entry 聚合条目
 * @returns {string} `[browser:network] {...}`
 */
export function formatBrowserNetworkLine(entry) {
	return `${BROWSER_NETWORK_PREFIX} ${JSON.stringify(entry)}`
}

/**
 * 文本是否为 test_watch 输出。
 * @param {string} text console 文本
 * @returns {boolean} 是否 test_watch
 */
export function isTestWatchConsoleText(text) {
	return text.includes(TEST_WATCH_CONSOLE_PREFIX)
}

/**
 * 文本是否为 i18n 缺键警告。
 * @param {string} text console 文本
 * @returns {boolean} 是否 `[i18n:missing]`
 */
export function isI18nMissingConsoleText(text) {
	return text.includes(I18N_MISSING_PREFIX)
}

/**
 * 等待页面至少完成一次 test_watch 轮询（`fount.test.watchLastRun`）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {number} [sinceMs=0] 要求 lastRun 严格晚于此时刻（0 表示任意一次）
 * @param {number} [timeoutMs=8000] 超时（含 locale 闸 / 确认轮）
 * @returns {Promise<void>}
 */
export async function waitForTestWatchCycle(page, sinceMs = 0, timeoutMs = 8000) {
	await page.waitForFunction(min => {
		const last = globalThis.fount?.test?.watchLastRun
		return typeof last === 'number' && last > min
	}, sinceMs, { timeout: timeoutMs })
}

/**
 * 创建绑定到单个 Playwright page 的诊断收集器。
 * @param {object} [options] 选项
 * @param {(url: string) => boolean} [options.shouldRecordNetwork] 返回 false 则忽略该 URL 的网络异常
 * @returns {{
 *   attach: (page: import('npm:@playwright/test').Page) => void,
 *   pageErrors: string[],
 *   testWatchErrors: string[],
 *   i18nMissingErrors: string[],
 *   flushNetworkDiagnostics: () => BrowserNetworkEntry[],
 * }} 诊断 API
 */
export function createBrowserDiagnostics(options = {}) {
	const shouldRecordNetwork = options.shouldRecordNetwork ?? (() => true)
	/** @type {string[]} */
	const pageErrors = []
	/** @type {string[]} */
	const testWatchErrors = []
	/** @type {string[]} */
	const i18nMissingErrors = []
	/** @type {Map<string, BrowserNetworkEntry>} */
	const aggregates = new Map()

	/**
	 * @param {import('npm:@playwright/test').Page} page Playwright 页面
	 * @returns {void}
	 */
	function attach(page) {
		page.on('pageerror', err => {
			pageErrors.push(String(err?.message || err))
		})
		page.on('console', msg => {
			const text = msg.text()
			if (isTestWatchConsoleText(text)) testWatchErrors.push(text)
			if (isI18nMissingConsoleText(text)) i18nMissingErrors.push(text)
		})
		page.on('requestfailed', req => {
			const error = req.failure()?.errorText || null
			if (isIgnoredBrowserNetworkError(error)) return
			if (!shouldRecordNetwork(req.url())) return
			recordBrowserNetworkEntry(aggregates, {
				kind: 'requestfailed',
				method: req.method(),
				status: null,
				url: req.url(),
				error,
			})
		})
		page.on('response', res => {
			const status = res.status()
			if (status < 400) return
			if (!shouldRecordNetwork(res.url())) return
			recordBrowserNetworkEntry(aggregates, {
				kind: 'http',
				method: res.request().method(),
				status,
				url: res.url(),
				error: null,
			})
		})
	}

	/**
	 * 将聚合结果刷到 stdout，并清空表。
	 * @returns {BrowserNetworkEntry[]} 本次刷出的条目
	 */
	function flushNetworkDiagnostics() {
		const entries = [...aggregates.values()]
		aggregates.clear()
		for (const entry of entries)
			console.log(formatBrowserNetworkLine(entry))
		return entries
	}

	return { attach, pageErrors, testWatchErrors, i18nMissingErrors, flushNetworkDiagnostics }
}

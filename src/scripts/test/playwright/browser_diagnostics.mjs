/**
 * 前端 Playwright 浏览器网络诊断：聚合 HTTP ≥400 / requestfailed，输出可被噪声检测识别的行。
 */

/** 写入 suite 输出、供 `detectNoiseHits` 识别的前缀。 */
export const BROWSER_NETWORK_PREFIX = '[browser:network]'

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
 * 创建绑定到单个 Playwright page 的诊断收集器。
 * @returns {{
 *   attach: (page: import('npm:@playwright/test').Page) => void,
 *   pageErrors: string[],
 *   flushNetworkDiagnostics: () => BrowserNetworkEntry[],
 * }} 诊断 API
 */
export function createBrowserDiagnostics() {
	/** @type {string[]} */
	const pageErrors = []
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
		page.on('requestfailed', req => {
			recordBrowserNetworkEntry(aggregates, {
				kind: 'requestfailed',
				method: req.method(),
				status: null,
				url: req.url(),
				error: req.failure()?.errorText || null,
			})
		})
		page.on('response', res => {
			const status = res.status()
			if (status < 400) return
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

	return { attach, pageErrors, flushNetworkDiagnostics }
}

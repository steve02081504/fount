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
 * 子 frame 的 SecurityError（含沙箱无 allow-same-origin 时读 serviceWorker；WPT 要求抛）。
 * 只认 CDP 结构化字段：`exception.className` + frame 归属；缺 className 则不忽略。
 * @param {{ exception?: { className?: string } } | null | undefined} exceptionDetails CDP Runtime.ExceptionDetails
 * @param {boolean} isMainFrame 是否主 frame
 * @returns {boolean} 是否应忽略
 */
export function isIgnoredChildFrameSecurityError(exceptionDetails, isMainFrame) {
	return !isMainFrame && exceptionDetails?.exception?.className === 'SecurityError'
}

/**
 * 浏览器网络诊断条目。
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
 * URL 原样记录——测试数据本就不该含持久化密钥；勿在此做脱敏遮掩。
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
 * 等待页面至少完成一次 test_watch 扫描（`fount.test.watchLastRun`）。
 * 先 `kickWatch()`（DOM 静止时不会自动扫），再等 lastRun 推进。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {number} [sinceMs=0] 要求 lastRun 严格晚于此时刻（0 表示任意一次）
 * @param {number} [timeoutMs=8000] 超时（含 locale 闸 / 确认轮）
 * @returns {Promise<void>}
 */
export async function waitForTestWatchCycle(page, sinceMs = 0, timeoutMs = 8000) {
	await page.evaluate(() => globalThis.fount?.test?.kickWatch?.())
	await page.waitForFunction(min => {
		const last = globalThis.fount?.test?.watchLastRun
		return typeof last === 'number' && last > min
	}, sinceMs, { timeout: timeoutMs })
}

/**
 * 强制中日英三语各检查一轮（短测不靠每秒轮换也能覆盖脚本断言）；
 * `cycleLocales` 内每语种附带一轮 a11y。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {number} [timeoutMs=30000] 超时
 * @returns {Promise<void>}
 */
export async function waitForLocaleCycle(page, timeoutMs = 30_000) {
	let timer
	try {
		await Promise.race([
			page.evaluate(async () => {
				await globalThis.fount?.test?.cycleLocales?.()
			}),
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					reject(new Error(`waitForLocaleCycle timed out after ${timeoutMs}ms`))
				}, timeoutMs)
			}),
		])
	}
	finally {
		clearTimeout(timer)
	}
}

/**
 * 将 CDP StackTrace 格式化为可读栈（字段均来自协议结构，不解析 summary text）。
 * @param {{ callFrames?: Array<{ functionName?: string, url?: string, lineNumber?: number, columnNumber?: number }> } | null | undefined} stackTrace CDP Runtime.StackTrace（或 null）
 * @returns {string} 多行栈文本，无帧则为空串
 */
export function formatCdpStackTrace(stackTrace) {
	const frames = stackTrace?.callFrames
	if (!frames?.length) return ''
	return frames.map(frame => {
		const where = `${frame.url ?? ''}:${(frame.lineNumber ?? 0) + 1}:${(frame.columnNumber ?? 0) + 1}`
		return `    at ${frame.functionName || '<anonymous>'} (${where})`
	}).join('\n')
}

/**
 * 从 CDP ExceptionDetails 取出展示用字段（name / stack 只取 RemoteObject 与 StackTrace）。
 * @param {object} exceptionDetails CDP Runtime.ExceptionDetails
 * @returns {{ name: string, stack: string }} 异常类名与展示栈
 */
export function pageErrorFromCdpException(exceptionDetails) {
	const exception = exceptionDetails?.exception
	const name = exception?.className ?? 'Error'
	const description = typeof exception?.description === 'string' ? exception.description : ''
	const framed = formatCdpStackTrace(exceptionDetails?.stackTrace)
	const stack = description || (framed ? `${name}\n${framed}` : name)
	return { name, stack }
}

/**
 * 创建绑定到单个 Playwright page 的诊断收集器。
 * @returns {{
 *   attach: (page: import('npm:@playwright/test').Page) => Promise<void>,
 *   pageErrors: string[],
 *   testWatchErrors: string[],
 *   i18nMissingErrors: string[],
 *   flushNetworkDiagnostics: () => BrowserNetworkEntry[],
 * }} 诊断 API
 */
export function createBrowserDiagnostics() {
	/** @type {string[]} */
	const pageErrors = []
	/** @type {string[]} */
	const testWatchErrors = []
	/** @type {string[]} */
	const i18nMissingErrors = []
	/** @type {Map<string, BrowserNetworkEntry>} */
	const aggregates = new Map()

	/**
	 * 经 CDP 挂 pageerror（可区分主/子 frame），并挂网络 / console 诊断。
	 * @param {import('npm:@playwright/test').Page} page Playwright 页面
	 * @returns {Promise<void>}
	 */
	async function attach(page) {
		const session = await page.context().newCDPSession(page)
		await session.send('Page.enable')

		/** @type {Map<number, string>} executionContextId → frameId */
		const contextFrameIds = new Map()
		const tree = await session.send('Page.getFrameTree')
		let mainFrameId = tree.frameTree.frame.id

		session.on('Page.frameNavigated', ({ frame }) => {
			if (!frame.parentId) mainFrameId = frame.id
		})
		// 须在 Runtime.enable 之前注册，才能收到 enable 补发的已有上下文事件
		session.on('Runtime.executionContextCreated', ({ context }) => {
			const frameId = context.auxData?.frameId
			if (frameId) contextFrameIds.set(context.id, frameId)
		})
		session.on('Runtime.executionContextDestroyed', ({ executionContextId }) => {
			contextFrameIds.delete(executionContextId)
		})
		session.on('Runtime.executionContextsCleared', () => {
			contextFrameIds.clear()
		})
		session.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
			const frameId = contextFrameIds.get(exceptionDetails.executionContextId)
			// 未知 context 保守当主 frame，避免误吞
			const isMainFrame = !frameId || frameId === mainFrameId
			if (isIgnoredChildFrameSecurityError(exceptionDetails, isMainFrame)) return
			const { stack } = pageErrorFromCdpException(exceptionDetails)
			console.error('[pageerror-stack]', stack)
			pageErrors.push(stack)
		})
		await session.send('Runtime.enable')

		page.on('console', msg => {
			const text = msg.text()
			if (isTestWatchConsoleText(text)) testWatchErrors.push(text)
			if (isI18nMissingConsoleText(text)) i18nMissingErrors.push(text)
		})
		page.on('requestfailed', req => {
			const error = req.failure()?.errorText || null
			if (isIgnoredBrowserNetworkError(error)) return
			if (/\/api\/ping(?:\?|$)/.test(req.url())) return // Pages 无节点时的探针失败不计入
			if (/:8930(?:\/|$)/.test(req.url())) return // 安装器存活探针
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

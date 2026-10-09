/**
 * 启动页（`/`）在 Service Worker 永不 ready 时也必须继续启动。
 *
 * 隧道 / 内嵌 WebView / 无痕等场景下浏览器可能拒绝注册 Service Worker
 *（`NotAllowedError: Registration failed - permission denied`），此时
 * `navigator.serviceWorker.ready` 永不 settle；旧实现无条件 await 它，
 * 启动页会一直停在 loading 转圈，连未登录分支（默认部件请求 → 登录跳转）都到不了。
 */
import { expect, test } from './fixtures.mjs'

/**
 * 让页面拿到一个「注册被拒 / 永不 ready」的 serviceWorker 桩。
 * @param {import('npm:@playwright/test').BrowserContext} context 浏览器上下文
 * @param {object} [options] 选项
 * @param {boolean} [options.hasController] 是否提供一个永不回话的 controller
 * @returns {Promise<void>} 无
 */
async function stubServiceWorker(context, { hasController = false } = {}) {
	await context.addInitScript(controllerPresent => {
		Object.defineProperty(navigator, 'serviceWorker', {
			configurable: true,
			value: {
				// controller 存在但 postMessage 永不回话：调用方不能无上限地等回执。
				controller: controllerPresent
					? {
						/** @returns {void} 故意不回话，模拟 worker 已卡死 */
						postMessage() { },
					}
					: null,
				ready: new Promise(() => { }),
				/**
				 * 模拟被拒的注册。
				 * @returns {Promise<never>} 永远拒绝
				 */
				async register() { throw new Error('Registration failed - permission denied') },
				/** @returns {void} 无监听可加 */
				addEventListener() { },
				/** @returns {void} 无监听可删 */
				removeEventListener() { },
			},
		})
	}, hasController)
}

test('start page proceeds past the service worker wait when it never becomes ready', async ({ browser, baseUrl }) => {
	// 匿名 context（未登录）+ 永不 ready 的 serviceWorker：复现「SW 注册被拒」。
	const context = await browser.newContext({ locale: 'zh-CN' })
	await stubServiceWorker(context)
	try {
		const page = await context.newPage()
		const defaultPartRequest = page.waitForRequest(
			request => request.url().includes('/api/defaultpart/getany/shells'),
			{ timeout: 30_000 },
		)
		await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
		// 修复前：wakeServer() 挂在 serviceWorker.ready 上永不返回，该请求不会发出。
		await defaultPartRequest
	}
	finally {
		await context.close()
	}
})

test('start page proceeds when the service worker never answers the wake request', async ({ browser, baseUrl }) => {
	// controller 存在但永不回 WAKE_SERVER_REQUEST：旧实现永远等 MessageChannel 回执。
	const context = await browser.newContext({ locale: 'zh-CN' })
	await stubServiceWorker(context, { hasController: true })
	try {
		const page = await context.newPage()
		const defaultPartRequest = page.waitForRequest(
			request => request.url().includes('/api/defaultpart/getany/shells'),
			{ timeout: 30_000 },
		)
		await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
		await defaultPartRequest
	}
	finally {
		await context.close()
	}
})

test('start page does not burn the whole controller wait when the registration is refused', async ({ browser, baseUrl }) => {
	// 注册被拒 ⇒ 永远不会有 controller 来接管：启动页（`await wakeServer()`）不该白等满 5 秒上限。
	const context = await browser.newContext({ locale: 'zh-CN' })
	await stubServiceWorker(context)
	try {
		const page = await context.newPage()
		const defaultPartRequest = page.waitForRequest(
			request => request.url().includes('/api/defaultpart/getany/shells'),
			{ timeout: 30_000 },
		)
		await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
		await defaultPartRequest
		// 只量探测本身：整页启动时长会带上 CDN 拉取，不是这条断言要管的事（实测那样会 flaky）。
		const probeMs = await page.evaluate(async () => {
			const module = await import('/base.mjs')
			const startedAt = performance.now()
			await module.queryWakeServer()
			return performance.now() - startedAt
		})
		expect(probeMs, 'registration refused: the controller wait must end immediately').toBeLessThan(2000)
	}
	finally {
		await context.close()
	}
})

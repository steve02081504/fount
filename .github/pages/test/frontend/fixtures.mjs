/**
 * GitHub Pages 静态站 Playwright fixture（无登录、无 fount 节点）。
 */
import { test as base, expect } from '@playwright/test'

import { createBrowserDiagnostics, waitForTestWatchCycle } from 'fount/scripts/test/playwright/browser_diagnostics.mjs'
import { requireTestBaseUrl } from 'fount/scripts/test/playwright/env.mjs'

/**
 * Pages 前端 E2E fixture：`baseUrl` + 已注入 `fount.test.enabled` 的 `context` / `page`。
 * @param {object} [options] fixture 选项
 * @param {string} [options.locale='zh-CN'] 浏览器与 localStorage 首选语言
 * @returns {{ test: typeof base, expect: typeof expect }} 扩展后的 test 与 expect
 */
export function createPagesFixtures(options = {}) {
	const locale = options.locale ?? 'zh-CN'

	const test = base.extend({
		/**
		 * @param {object} _fixtures 未使用
		 * @param {(url: string) => Promise<void>} use fixture use
		 */
		baseUrl: async ({}, use) => {
			await use(requireTestBaseUrl())
		},
		/**
		 * @param {object} dependencies fixture 依赖
		 * @param {import('npm:@playwright/test').Browser} dependencies.browser 浏览器
		 * @param {(context: import('npm:@playwright/test').BrowserContext) => Promise<void>} use fixture use
		 */
		context: async ({ browser }, use) => {
			const context = await browser.newContext({ locale })
			await context.addInitScript(language => {
				try {
					localStorage.setItem('userPreferredLanguages', JSON.stringify([language]))
					localStorage.setItem('fountTheme', 'light')
					// 死主机：protocol 页走 offline dialog，避免假 ping 成功后跳走
					localStorage.setItem('fountHostUrl', 'http://127.0.0.1:9')
				}
				catch { /* 沙箱 iframe 无 same-origin */ }
			}, locale)
			await context.addInitScript(() => {
				globalThis.fount ??= {}
				globalThis.fount.test ??= {}
				globalThis.fount.test.enabled = true
			})
			await use(context)
			await context.close()
		},
		/**
		 * @param {object} dependencies fixture 依赖
		 * @param {import('npm:@playwright/test').BrowserContext} dependencies.context 上下文
		 * @param {(page: import('npm:@playwright/test').Page) => Promise<void>} use fixture use
		 */
		page: async ({ context }, use) => {
			const diagnostics = createBrowserDiagnostics({
				/**
				 * 安装页会轮询 localhost:8930（安装器）与 :8931/api/ping；无节点时属预期失败。
				 * （ORB 由 browser_diagnostics 统一忽略，不必按域名滤。）
				 * @param {string} url 请求 URL
				 * @returns {boolean} 是否记入网络诊断
				 */
				shouldRecordNetwork: url =>
					!/\/api\/ping(?:\?|$)/.test(url)
					&& !/^https?:\/\/(localhost|127\.0\.0\.1):8930(?:\/|$)/.test(url),
			})
			const page = await context.newPage()
			diagnostics.attach(page)
			await use(page)
			let since = Date.now()
			await waitForTestWatchCycle(page, since).catch(() => { /* 未挂载 test_watch 则跳过 */ })
			since = Date.now()
			await waitForTestWatchCycle(page, since).catch(() => {})
			diagnostics.flushNetworkDiagnostics()
			expect(diagnostics.pageErrors, 'unexpected browser page errors').toEqual([])
			expect(diagnostics.testWatchErrors, 'unexpected test_watch console output').toEqual([])
		},
	})

	return { test, expect }
}

const fixtures = createPagesFixtures()
export const test = fixtures.test
export { expect }

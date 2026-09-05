/**
 * GitHub Pages 静态站 Playwright fixture（无登录、无 fount 节点）。
 */
import { test as base, expect } from '@playwright/test'

import { runDiagnosedPage, waitForWatchDrain } from 'fount/scripts/test/playwright/browser_diagnostics.mjs'
import { installCdnResponseCache } from 'fount/scripts/test/playwright/cdn_cache.mjs'
import { requireTestBaseUrl } from 'fount/scripts/test/playwright/env.mjs'
import { assertAriaIgnoreIssues } from 'fount/scripts/test/playwright/github_issue.mjs'

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
		 * @param {object} dependencies fixture 依赖
		 * @param {import('npm:@playwright/test').Browser} dependencies.browser 未使用（满足 no-empty-pattern）
		 * @param {(url: string) => Promise<void>} use fixture use
		 */
		baseUrl: async ({ browser: _browser }, use) => {
			await use(requireTestBaseUrl())
		},
		/**
		 * @param {object} dependencies fixture 依赖
		 * @param {import('npm:@playwright/test').Browser} dependencies.browser 浏览器
		 * @param {(context: import('npm:@playwright/test').BrowserContext) => Promise<void>} use fixture use
		 */
		context: async ({ browser }, use) => {
			const context = await browser.newContext({ locale, serviceWorkers: 'block' })
			await installCdnResponseCache(context)
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
			const hubUrl = (process.env.FOUNT_TEST_HUB_URL || '').trim()
			if (hubUrl)
				await context.addInitScript(url => {
					globalThis.fount ??= {}
					globalThis.fount.test ??= {}
					globalThis.fount.test.hubUrl = url
				}, hubUrl)

			await use(context)
			await context.close()
		},
		/**
		 * @param {object} dependencies fixture 依赖
		 * @param {import('npm:@playwright/test').BrowserContext} dependencies.context 上下文
		 * @param {(page: import('npm:@playwright/test').Page) => Promise<void>} use fixture use
		 */
		page: async ({ context }, use) => {
			await runDiagnosedPage(context, use, async (diagnostics, page) => {
				// 收尾：watch.drain()（locale + a11y）；未挂载时 evaluate 立即返回
				await waitForWatchDrain(page)
				await assertAriaIgnoreIssues(page)
				diagnostics.flushNetworkDiagnostics()
				expect(diagnostics.pageErrors, 'unexpected browser page errors').toEqual([])
				expect(diagnostics.consoleErrors, 'unexpected browser console errors').toEqual([])
				expect(diagnostics.pageWatchErrors, 'unexpected page watch console output').toEqual([])
				expect(diagnostics.i18nMissingErrors, 'unexpected missing i18n keys').toEqual([])
			})
		},
	})

	return { test, expect }
}

const fixtures = createPagesFixtures()
/** 默认 Pages E2E 用例（`createPagesFixtures()` 产物）。 */
export const { test } = fixtures
/** 重导出 Playwright `expect` 断言。 */
export { expect }

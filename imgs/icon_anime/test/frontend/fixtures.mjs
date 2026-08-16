/**
 * icon_anime DOM 终端 Playwright fixture（无 fount 节点）。
 */
import { test as base, expect } from '@playwright/test'
import { createBrowserDiagnostics } from 'fount/scripts/test/playwright/browser_diagnostics.mjs'
import { installCdnResponseCache } from 'fount/scripts/test/playwright/cdn_cache.mjs'
import { assertAriaIgnoreIssues } from 'fount/scripts/test/playwright/github_issue.mjs'

const test = base.extend({
	/**
	 * @param {object} dependencies fixture 依赖
	 * @param {import('npm:@playwright/test').Browser} dependencies.browser 浏览器
	 * @param {(context: import('npm:@playwright/test').BrowserContext) => Promise<void>} use fixture use
	 */
	context: async ({ browser }, use) => {
		const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block' })
		await installCdnResponseCache(context)
		await use(context)
		await context.close()
	},
	/**
	 * @param {object} dependencies fixture 依赖
	 * @param {import('npm:@playwright/test').BrowserContext} dependencies.context 上下文
	 * @param {(page: import('npm:@playwright/test').Page) => Promise<void>} use fixture use
	 */
	page: async ({ context }, use) => {
		const diagnostics = createBrowserDiagnostics()
		const page = await context.newPage()
		await diagnostics.attach(page)
		await use(page)
		await assertAriaIgnoreIssues(page)
		diagnostics.flushNetworkDiagnostics()
		expect(diagnostics.pageErrors, 'unexpected browser page errors').toEqual([])
		expect(diagnostics.pageWatchErrors, 'unexpected page watch console output').toEqual([])
		expect(diagnostics.i18nMissingErrors, 'unexpected missing i18n keys').toEqual([])
	},
})

/** icon_anime 前端用例。 */
export { test, expect }

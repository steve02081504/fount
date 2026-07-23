import { test as base, expect, request } from '@playwright/test'

import { ms } from '../../ms.mjs'

import { loginWithApiKey } from './auth.mjs'
import { createBrowserDiagnostics, waitForTestWatchCycle } from './browser_diagnostics.mjs'
import { requireTestBaseUrl } from './env.mjs'
import { assertIsolatedFrontendTest } from './guards.mjs'

/**
 * fount 前端 E2E 通用 fixture：`baseUrl` / `apiKey` / 已登录 `context` + `page`。
 * page 自动挂载网络诊断（HTTP ≥400 / requestfailed → `[browser:network]`）与 pageerror 硬断言。
 * @param {object} [options] fixture 选项
 * @param {string} [options.locale='zh-CN'] 浏览器与 localStorage 首选语言
 * @param {object} [options.isolated] 隔离节点断言（run.mjs 注入）
 * @param {string} [options.isolated.usernameEnv='FOUNT_TEST_USERNAME'] 用户名环境变量
 * @param {string} options.isolated.shellLabel 错误提示用 shell 名
 * @param {number|string} [options.isolated.timeout] beforeEach 内 setTimeout
 * @param {(args: { page: import('npm:@playwright/test').Page, baseUrl: string, apiKey: string }) => Promise<void>} [options.isolated.beforeEach] 额外钩子
 * @returns {{ test: typeof base, expect: typeof expect }} 扩展后的 test 与 expect
 */
export function createFountFixtures(options = {}) {
	const locale = options.locale ?? 'zh-CN'

	const test = base.extend({
		/**
		 * 注入测试根 URL fixture。
		 * @param {object} fixtures - Playwright fixture 依赖（未使用）
		 * @param {(url: string) => Promise<void>} use - Playwright fixture use 回调
		 */
		baseUrl: async ({}, use) => {
			await use(requireTestBaseUrl())
		},
		/**
		 * 注入 API key fixture。
		 * @param {object} fixtures - Playwright fixture 依赖（未使用）
		 * @param {(key: string) => Promise<void>} use - Playwright fixture use 回调
		 */
		apiKey: async ({}, use) => {
			const apiKey = process.env.FOUNT_API_KEY
			if (!apiKey) throw new Error('FOUNT_API_KEY is required for fount frontend tests')
			await use(apiKey)
		},
		/**
		 * 创建已登录的 BrowserContext fixture。
		 * @param {object} dependencies - Playwright fixture 依赖
		 * @param {import('npm:@playwright/test').Browser} dependencies.browser - 浏览器实例
		 * @param {string} dependencies.baseUrl - 测试根 URL
		 * @param {string} dependencies.apiKey - API 密钥
		 * @param {(context: import('npm:@playwright/test').BrowserContext) => Promise<void>} use - Playwright fixture use 回调
		 */
		context: async ({ browser, baseUrl, apiKey }, use) => {
			const api = await request.newContext()
			await loginWithApiKey(api, baseUrl, apiKey)
			const storageState = await api.storageState()
			await api.dispose()
			const context = await browser.newContext({ storageState, locale })
			await context.addInitScript(language => {
				localStorage.setItem('userPreferredLanguages', JSON.stringify([language]))
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
		 * 从已登录 context 创建 Page fixture，并挂载浏览器诊断。
		 * @param {object} dependencies - Playwright fixture 依赖
		 * @param {import('npm:@playwright/test').BrowserContext} dependencies.context - 已登录浏览器上下文
		 * @param {(page: import('npm:@playwright/test').Page) => Promise<void>} use - Playwright fixture use 回调
		 */
		page: async ({ context }, use) => {
			const diagnostics = createBrowserDiagnostics()
			const page = await context.newPage()
			diagnostics.attach(page)
			await use(page)
			// 测试体结束后再等两轮 test_watch（locale 闸 + 确认命中）
			let since = Date.now()
			await waitForTestWatchCycle(page, since).catch(() => { /* 未挂载 test_watch 则跳过 */ })
			since = Date.now()
			await waitForTestWatchCycle(page, since).catch(() => {})
			diagnostics.flushNetworkDiagnostics()
			expect(diagnostics.pageErrors, 'unexpected browser page errors').toEqual([])
			expect(diagnostics.testWatchErrors, 'unexpected test_watch console output').toEqual([])
		},
	})

	if (options.isolated) {
		const {
			usernameEnv = 'FOUNT_TEST_USERNAME',
			shellLabel,
			timeout,
			beforeEach: extraBeforeEach,
		} = options.isolated
		test.beforeEach(async ({ page, baseUrl, apiKey }) => {
			const expectedUsername = process.env[usernameEnv]
			if (!expectedUsername)
				throw new Error(`${usernameEnv} is required; run via test/frontend/run.mjs`)
			if (timeout != null) test.setTimeout(typeof timeout === 'number' ? timeout : ms(timeout))
			if (extraBeforeEach) await extraBeforeEach({ page, baseUrl, apiKey })
			await assertIsolatedFrontendTest({
				baseUrl,
				apiKey,
				expectedUsername,
				shellLabel,
			})
		})
	}

	return { test, expect }
}

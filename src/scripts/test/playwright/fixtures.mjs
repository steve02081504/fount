import { test as base, expect, request } from '@playwright/test'

import { loginWithApiKey } from './auth.mjs'
import { requireTestBaseUrl } from './env.mjs'

/**
 * fount 前端 E2E 通用 fixture：`baseUrl` / `apiKey` / 已登录 `context` + `page`。
 * @param {object} [options] fixture 选项
 * @param {string} [options.locale='zh-CN'] 浏览器与 localStorage 首选语言
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
			const key = process.env.FOUNT_API_KEY
			if (!key) throw new Error('FOUNT_API_KEY is required for fount frontend tests')
			await use(key)
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
			await use(context)
			await context.close()
		},
		/**
		 * 从已登录 context 创建 Page fixture。
		 * @param {object} dependencies - Playwright fixture 依赖
		 * @param {import('npm:@playwright/test').BrowserContext} dependencies.context - 已登录浏览器上下文
		 * @param {(page: import('npm:@playwright/test').Page) => Promise<void>} use - Playwright fixture use 回调
		 */
		page: async ({ context }, use) => {
			await use(await context.newPage())
		},
	})

	return { test, expect }
}

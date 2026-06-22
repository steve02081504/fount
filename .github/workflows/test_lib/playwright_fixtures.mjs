import { test as base, expect, request } from '@playwright/test'

import { loginWithApiKey } from './playwright_auth.mjs'

/**
 * fount 前端 E2E 通用 fixture：`baseUrl` / `apiKey` / 已登录 `context` + `page`。
 * @param {object} [opts]
 * @param {string} [opts.locale='zh-CN'] 浏览器与 localStorage 首选语言
 * @returns {{ test: typeof base, expect: typeof expect }}
 */
export function createFountFixtures(opts = {}) {
	const locale = opts.locale ?? 'zh-CN'

	const test = base.extend({
		baseUrl: async ({}, use) => {
			const url = process.env.FOUNT_TEST_BASE_URL || 'http://localhost:8931'
			await use(url.replace(/\/$/, ''))
		},
		apiKey: async ({}, use) => {
			const key = process.env.FOUNT_API_KEY
			if (!key) throw new Error('FOUNT_API_KEY is required for fount frontend tests')
			await use(key)
		},
		context: async ({ browser, baseUrl, apiKey }, use) => {
			const req = await request.newContext()
			await loginWithApiKey(req, baseUrl, apiKey)
			const storageState = await req.storageState()
			await req.dispose()
			const context = await browser.newContext({ storageState, locale })
			await context.addInitScript(lang => {
				localStorage.setItem('userPreferredLanguages', JSON.stringify([lang]))
			}, locale)
			await use(context)
			await context.close()
		},
		page: async ({ context }, use) => {
			await use(await context.newPage())
		},
	})

	return { test, expect }
}

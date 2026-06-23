import { defineConfig } from '@playwright/test'

import { resolveBrowserUseOptions } from './playwright_browser.mjs'
import { requireTestBaseUrl } from './playwright_env.mjs'

/**
 * 创建 fount E2E 通用 Playwright 配置。
 * @param {object} opts - 配置选项。
 * @param {string} opts.testDir 用例目录（绝对或相对 repo 根）
 * @param {Partial<import('npm:@playwright/test').PlaywrightTestConfig>} [opts.overrides] 覆盖项
 * @returns {Promise<import('npm:@playwright/test').PlaywrightTestConfig>} Playwright 配置对象。
 */
export async function createPlaywrightConfig({ testDir, overrides = {} }) {
	const browserUse = await resolveBrowserUseOptions()
	const baseURL = requireTestBaseUrl()
	return defineConfig({
		testDir,
		testMatch: '*.spec.mjs',
		timeout: 60_000,
		expect: { timeout: 20_000 },
		workers: 1,
		retries: process.env.CI ? 1 : 0,
		reporter: process.env.CI ? 'github' : 'list',
		use: {
			baseURL,
			headless: true,
			trace: 'retain-on-failure',
			...browserUse,
		},
		...overrides,
	})
}

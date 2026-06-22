import { createFountFixtures } from '../../../../../../../.github/workflows/test_lib/playwright_fixtures.mjs'

export const { test, expect } = createFountFixtures({ locale: 'zh-CN' })

/**
 * 打开 Social 首页并等待 i18n 与 feed 就绪。
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @returns {Promise<void>}
 */
export async function openSocialHome(page, baseUrl) {
	await page.goto(`${baseUrl}/parts/shells:social/`)
	await expect(page.locator('h1')).toHaveText('社交', { timeout: 30_000 })
	await expect(page.locator('#feedView')).toBeVisible()
}

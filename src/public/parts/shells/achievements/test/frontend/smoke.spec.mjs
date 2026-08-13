/**
 * Achievements shell 前端 smoke：页面可加载、成就列表经模板渲染。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Achievements shell smoke', () => {
	test('achievements page boots and renders sections', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:achievements/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('h1[data-i18n="achievements.pageHeader"]')).toBeVisible()
		const container = page.locator('#achievements-container')
		await expect(container).toBeVisible()
		await expect(container.locator(':scope > *').first()).toBeVisible({ timeout: 30_000 })
	})
})

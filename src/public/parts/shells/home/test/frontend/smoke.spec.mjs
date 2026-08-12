/**
 * Home shell 前端 smoke：页面可加载、核心控件可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Home shell smoke', () => {
	test('home page boots with filter and part list', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:home/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#filter-input')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('main')).toBeVisible()
		await expect(page.locator('#page-title')).toBeVisible()
		await expect(page.locator('#part-types-containers')).toBeVisible()
		await expect(page.locator('#function-buttons-container')).toBeAttached()
	})
})

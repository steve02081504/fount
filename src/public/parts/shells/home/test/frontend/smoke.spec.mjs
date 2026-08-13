/**
 * Home shell 前端 smoke：页面可加载、核心控件可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Home shell smoke', () => {
	test('home page boots with filter and part list', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:home/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#filter-input')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('main')).toBeVisible()
		const pageTitle = page.locator('#page-title')
		await expect(pageTitle).toBeVisible()
		await expect(pageTitle).not.toHaveText('', { timeout: 30_000 })
		await expect(page.locator('#part-types-containers > .part-items-grid:not(.hidden)').first()).toBeVisible({
			timeout: 30_000,
		})
		await expect(page.locator('#function-buttons-container')).toBeAttached()
	})
})

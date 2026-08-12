/**
 * ThemeManage shell 前端 smoke：页面可加载、主题卡片经模板渲染。
 */
import { test, expect } from './fixtures.mjs'

test.describe('ThemeManage shell smoke', () => {
	test('theme manage page boots with theme cards', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:themeManage/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#theme-search-input')).toBeVisible()
		await expect(page.locator('#create-theme-button')).toBeVisible()
		const grid = page.locator('#theme-grid')
		await expect(grid).toBeVisible()
		await expect(grid.locator(':scope > *').first()).toBeVisible({ timeout: 30_000 })
	})
})

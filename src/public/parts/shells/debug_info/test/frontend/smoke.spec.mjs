/**
 * debug_info shell 前端 smoke：页面可加载、系统信息表渲染。
 */
import { test, expect } from './fixtures.mjs'

test.describe('debug_info shell smoke', () => {
	test('debug info page boots with system table', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#copy-button')).toBeVisible()
		await expect(page.locator('h1[data-i18n="debug_info.heading"]')).toBeVisible()
		const systemTable = page.locator('#system-info-table')
		await expect(systemTable).toBeVisible()
		await expect(systemTable.locator('tr').first()).toBeVisible({ timeout: 30_000 })
	})
})

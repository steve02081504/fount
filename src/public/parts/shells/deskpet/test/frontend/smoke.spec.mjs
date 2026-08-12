/**
 * Deskpet shell 前端 smoke：页面可加载、启动控件可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Deskpet shell smoke', () => {
	test('deskpet page boots with launcher controls', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:deskpet/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#start-pet-button')).toBeVisible()
		await expect(page.locator('#char-select-dropdown')).toBeVisible()
		await expect(page.locator('#running-pets-list')).toBeVisible()
	})
})

/**
 * Discord bot shell 前端 smoke：页面可加载、核心控件可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Discord bot shell smoke', () => {
	test('config page loads with bot controls', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:discordbot/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#new-bot')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#token-input')).toBeVisible()
		await expect(page.locator('#save-config')).toBeVisible()
		await expect(page.locator('#start-stop-bot')).toBeVisible()
		await expect(page.locator('#bot-list-dropdown')).toBeVisible()
		await expect(page.locator('#char-select-dropdown')).toBeVisible()
	})
})

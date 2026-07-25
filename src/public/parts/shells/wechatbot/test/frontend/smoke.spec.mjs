/**
 * WeChat bot shell 前端 smoke：页面可加载、核心控件与扫码入口可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('WeChat bot shell smoke', () => {
	test('config page loads with bot controls', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:wechatbot/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#new-bot')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#token-input')).toBeVisible()
		await expect(page.locator('#save-config')).toBeVisible()
		await expect(page.locator('#start-stop-bot')).toBeVisible()
		await expect(page.locator('#qr-start')).toBeVisible()
		await expect(page.locator('#bot-list-dropdown')).toBeVisible()
		await expect(page.locator('#char-select-dropdown')).toBeVisible()
	})
})

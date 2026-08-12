/**
 * UserSettings shell 前端 smoke：页面可加载、用户信息与设备列表就绪。
 */
import { test, expect } from './fixtures.mjs'

test.describe('UserSettings shell smoke', () => {
	test('user settings page boots with profile and device list', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:userSettings/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#userInfoUsername')).toBeVisible()
		await expect(page.locator('#userInfoUsername')).not.toHaveText('', { timeout: 30_000 })
		await expect(page.locator('#changePasswordForm')).toBeVisible()
		await expect(page.locator('#deviceListContainer')).toBeVisible()
		await expect(page.locator('#refreshDevicesButton')).toBeVisible()
	})
})

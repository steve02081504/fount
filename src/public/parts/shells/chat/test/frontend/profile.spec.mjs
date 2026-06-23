import { test, expect } from './fixtures.mjs'

test.describe('Chat profile page', () => {
	test('profile page and hub profile link', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-avatar')).toBeVisible()

		await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
		await page.locator('.hub-user-settings-link').click()
		await expect(page).toHaveURL(/\/parts\/shells:chat\/profile/, { timeout: 30_000 })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})
})

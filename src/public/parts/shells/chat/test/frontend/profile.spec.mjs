import { test, expect, openChatHub } from './fixtures.mjs'

test.describe('Chat profile page', () => {
	test('profile page loads with edit button', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`)
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-avatar')).toBeVisible()
	})

	test('hub profile link navigates to profile', async ({ page, baseUrl }) => {
		await openChatHub(page, baseUrl)
		await page.locator('.hub-user-settings-link').click()
		await expect(page).toHaveURL(/\/parts\/shells:chat\/profile/)
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})
})

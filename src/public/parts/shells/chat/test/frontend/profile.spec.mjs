import { test, expect } from './fixtures.mjs'

test.describe('Chat profile page', () => {
	test('profile page and hub profile link', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#profile-card-host [data-entity-profile-avatar]')).toBeVisible()
		await expect(page.locator('.profile-owner-details')).not.toHaveAttribute('open', '')

		await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
		await page.locator('.hub-user-settings-link').click()
		await expect(page).toHaveURL(/\/parts\/shells:chat\/profile/, { timeout: 30_000 })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})

	test('profile edit opens modal', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
		// Wait for profile data to fully load before clicking (ensures currentEntityHash is set)
		await expect(page.locator('#profile-card-host [data-entity-profile-name]')).not.toBeEmpty({ timeout: 30_000 })
		await page.locator('#profile-edit-button').click()
		await expect(page.locator('#hub-profile-edit-modal')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#hub-profile-edit-live-preview')).toBeVisible()
		await page.locator('#hub-profile-edit-name').fill('实时预览名称')
		await expect(page.locator('#hub-profile-edit-live-preview [data-entity-profile-name]')).toHaveText('实时预览名称')
		await page.locator('#hub-profile-edit-cancel').click()
		await expect(page.locator('#hub-profile-edit-modal')).toBeHidden({ timeout: 10_000 })
	})
})

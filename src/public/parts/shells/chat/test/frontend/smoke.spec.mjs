import { test, expect, waitForHubShell } from './fixtures.mjs'

test.describe('Chat shell smoke', () => {
	test('hub shell loads and root redirects to hub', async ({ page, baseUrl }) => {
		if (!page.url().includes('/parts/shells:chat/hub/'))
			await waitForHubShell(page, baseUrl)
		await expect(page.locator('#channel-bar')).toBeVisible()
		await expect(page.locator('#hub-messages')).toBeVisible()
		await expect(page.locator('#hub-add-server-button')).toBeVisible()

		await page.goto(`${baseUrl}/parts/shells:chat/`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/parts\/shells:chat\/hub\//, { timeout: 30_000 })
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 30_000 })
	})
})

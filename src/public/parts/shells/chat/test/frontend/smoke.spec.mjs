import { test, expect, waitForHubShell, TEST_USERNAME } from './fixtures.mjs'

test.describe('Chat shell smoke', () => {
	test('hub shell, isolated user, login redirect, and root redirect', async ({ page, baseUrl, apiKey, browser }) => {
		if (!page.url().includes('/parts/shells:chat/hub/'))
			await waitForHubShell(page, baseUrl)
		await expect(page.locator('#channel-bar')).toBeVisible()
		await expect(page.locator('#hub-messages')).toBeVisible()
		await expect(page.locator('#hub-add-server-button')).toBeVisible()

		const res = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		expect(res.ok).toBe(true)
		expect((await res.json()).username).toBe(TEST_USERNAME)

		const guest = await browser.newContext()
		try {
			const guestPage = await guest.newPage()
			await guestPage.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
			await expect(guestPage).toHaveURL(/\/login/)
		}
		finally {
			await guest.close()
		}

		await page.goto(`${baseUrl}/parts/shells:chat/`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/parts\/shells:chat\/hub\//, { timeout: 30_000 })
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 30_000 })
	})
})

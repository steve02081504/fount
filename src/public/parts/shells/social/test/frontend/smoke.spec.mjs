import { test, expect, openSocialHome, TEST_USERNAME } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('hub shell, isolated user, and login redirect', async ({ page, baseUrl, apiKey, browser }) => {
		expect(process.env.FOUNT_TEST_ISOLATED).toBe('1')
		const res = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		expect(res.ok).toBe(true)
		expect((await res.json()).username).toBe(TEST_USERNAME)

		await openSocialHome(page, baseUrl)
		await expect(page.locator('#feedView')).toBeVisible()

		const guest = await browser.newContext()
		try {
			const guestPage = await guest.newPage()
			await guestPage.goto(`${baseUrl}/parts/shells:social/`, { waitUntil: 'domcontentloaded' })
			await expect(guestPage).toHaveURL(/\/login/)
		}
		finally {
			await guest.close()
		}
	})
})

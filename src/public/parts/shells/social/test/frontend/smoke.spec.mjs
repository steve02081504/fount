import { test, expect, openSocialHome, TEST_USERNAME } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('hub shell and isolated user', async ({ page, baseUrl, apiKey }) => {
		const res = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		expect(res.ok).toBe(true)
		expect((await res.json()).username).toBe(TEST_USERNAME)

		await openSocialHome(page, baseUrl)
		await expect(page.locator('#feedView')).toBeVisible()
	})
})

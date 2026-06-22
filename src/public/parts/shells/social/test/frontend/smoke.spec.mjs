import { test, expect, openSocialHome, TEST_USERNAME } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('loads feed view after apiKey login', async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
		await expect(page.locator('#composer')).toBeVisible()
		await expect(page.locator('#postText')).toBeVisible()
		await expect(page.locator('#postBtn')).toHaveText('发布')
	})

	test('runs against isolated test user only', async ({ baseUrl, apiKey }) => {
		expect(process.env.FOUNT_TEST_ISOLATED).toBe('1')
		const res = await fetch(`${baseUrl}/api/whoami?fount-apikey=${encodeURIComponent(apiKey)}`)
		expect(res.ok).toBe(true)
		const data = await res.json()
		expect(data.username).toBe(TEST_USERNAME)
	})

	test('redirects to login without session', async ({ browser, baseUrl }) => {
		const context = await browser.newContext()
		const page = await context.newPage()
		await page.goto(`${baseUrl}/parts/shells:social/`)
		await expect(page).toHaveURL(/\/login/)
		await context.close()
	})
})

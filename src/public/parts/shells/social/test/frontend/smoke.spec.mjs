import { test, expect, openSocialHome } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('loads feed view after apiKey login', async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
		await expect(page.locator('#composer')).toBeVisible()
		await expect(page.locator('#postText')).toBeVisible()
		await expect(page.locator('#postBtn')).toHaveText('发布')
	})

	test('redirects to login without session', async ({ browser, baseUrl }) => {
		const context = await browser.newContext()
		const page = await context.newPage()
		await page.goto(`${baseUrl}/parts/shells:social/`)
		await expect(page).toHaveURL(/\/login/)
		await context.close()
	})
})

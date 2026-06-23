import { test, expect } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('redirects to login without session', async ({ browser, baseUrl }) => {
		const context = await browser.newContext()
		const page = await context.newPage()
		await page.goto(`${baseUrl}/parts/shells:social/`)
		await expect(page).toHaveURL(/\/login/)
		await context.close()
	})
})

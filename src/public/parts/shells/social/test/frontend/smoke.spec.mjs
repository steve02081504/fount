import { test, expect, openSocialHome } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('hub shell loads feed view', async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
		await expect(page.locator('#feedView')).toBeVisible()
	})
})

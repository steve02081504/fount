import { test, expect, openHome } from './fixtures.mjs'

test.describe('Social shell smoke', () => {
	test('hub shell loads feed view', async ({ page, baseUrl }) => {
		await openHome(page, baseUrl)
		await expect(page.locator('#feedView')).toBeVisible()
	})
})

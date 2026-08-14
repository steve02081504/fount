/**
 * oauth_handler shell 前端 smoke：说明页与缺参 callback。
 */
import { expect, test } from './fixtures.mjs'

test.describe('oauth_handler shell smoke', () => {
	test('index page boots', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:oauth_handler/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('h1[data-i18n="oauth_handler.title"]')).toBeVisible({ timeout: 30_000 })
	})

	test('callback without params shows missingParams', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:oauth_handler/callback`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#message')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#message')).toHaveAttribute('data-i18n', /oauth_handler\.callback\.(missingParams|working)/)
	})
})

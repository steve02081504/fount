/**
 * oauth_handler shell 前端 smoke：说明页与缺参 callback。
 */
import { expect, test } from './fixtures.mjs'

test.describe('oauth_handler shell smoke', () => {
	test('index page boots', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:oauth_handler/`, { waitUntil: 'domcontentloaded' })
		const title = page.locator('h1[data-i18n="oauth_handler.title"]')
		const description = page.locator('p[data-i18n="oauth_handler.description"]')
		await expect(title).toBeVisible({ timeout: 30_000 })
		await expect(title).toHaveText(/\S/)
		await expect(description).toBeVisible({ timeout: 30_000 })
		await expect(description).toHaveText(/\S/)
	})

	test('callback without params shows missingParams', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:oauth_handler/callback`, { waitUntil: 'domcontentloaded' })
		const title = page.locator('h1[data-i18n="oauth_handler.title"]')
		const message = page.locator('#message')
		await expect(title).toBeVisible({ timeout: 30_000 })
		await expect(title).toHaveText(/\S/)
		await expect(message).toBeVisible({ timeout: 30_000 })
		await expect(message).toHaveAttribute('data-i18n', 'oauth_handler.callback.missingParams', { timeout: 30_000 })
		await expect(message).toHaveText(/\S/)
	})
})

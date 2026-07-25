import { expect, test } from './fixtures.mjs'

test.describe('GitHub Pages smoke', () => {
	test('root redirects toward install wait', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
		await expect(page).toHaveURL(/\/wait\/install\/?/, { timeout: 30_000 })
		await expect(page.locator('#launchButton')).toBeVisible({ timeout: 30_000 })
		// hero 入场结束后内容才对 AT 可见，避免 test_watch 误报 empty-heading
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
	})

	test('install wait screen loads base + test watch', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/wait/install/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#launchButton')).toBeVisible({ timeout: 30_000 })
		await expect.poll(async () => page.evaluate(() => Boolean(globalThis.fount?.test?.watchStarted)), {
			timeout: 15_000,
		}).toBe(true)
		await expect(page.locator('.hero-content.visible-after-intro')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('h1').first()).toBeAttached()
	})

	test('protocol shows offline dialog; badges render', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/protocol/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#offline_dialog')).toBeVisible({ timeout: 30_000 })

		await page.goto(`${baseUrl}/badges/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
		await expect.poll(async () => page.evaluate(() => Boolean(globalThis.fount?.test?.watchStarted)), {
			timeout: 15_000,
		}).toBe(true)
	})
})

import { test, expect, openSocialHome } from './fixtures.mjs'

test.describe('Social navigation', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('switches between main views', async ({ page }) => {
		const views = [
			{ name: 'explore', selector: '#exploreView' },
			{ name: 'notifications', selector: '#notificationsView' },
			{ name: 'saved', selector: '#savedView' },
			{ name: 'profile', selector: '#profileView' },
			{ name: 'feed', selector: '#feedView' },
		]

		for (const { name, selector } of views) {
			await page.locator(`.nav-btn[data-view="${name}"]`).click()
			await expect(page.locator(selector)).toBeVisible()
			if (name === 'feed')
				await expect(page.locator('#composer')).toBeVisible()
			else
				await expect(page.locator('#composer')).toBeHidden()
		}
	})

	test('feed search UI toggles clear button', async ({ page }) => {
		const input = page.locator('#feedSearchInput')
		await input.fill('ab')
		await expect(page.locator('#feedSearchClearBtn')).toBeHidden()
		await page.locator('#feedSearchBtn').click()
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
		await page.locator('#feedSearchClearBtn').click()
		await expect(input).toHaveValue('')
	})
})

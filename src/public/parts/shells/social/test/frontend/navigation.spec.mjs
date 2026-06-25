import { test, expect, openSocialHome, expectPostInFeed } from './fixtures.mjs'

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

	test('feed search filters posts and clear restores feed', async ({ page, publishPost }) => {
		const tag = `navsrch${Date.now()}`
		const { postId } = await publishPost(`nav-filter #${tag}`)
		await expectPostInFeed(page, postId)

		const input = page.locator('#feedSearchInput')
		await input.fill(`#${tag}`)
		await page.locator('#feedSearchBtn').click()
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeVisible({ timeout: 30_000 })

		await input.fill(`__no-match-${Date.now()}__`)
		await page.locator('#feedSearchBtn').click()
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeHidden({ timeout: 30_000 })

		await page.locator('#feedSearchClearBtn').click()
		await expect(input).toHaveValue('')
		await expectPostInFeed(page, postId)
	})
})

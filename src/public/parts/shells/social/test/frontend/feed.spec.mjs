import {
	test,
	expect,
	openSocialHome,
	publishPostViaComposer,
	expectPostInFeed,
} from './fixtures.mjs'

test.describe('Social feed', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('feed refresh reloads posts', async ({ page }) => {
		const text = `refresh-test ${Date.now()}`
		await publishPostViaComposer(page, text)
		await expectPostInFeed(page, text)
		const [feedResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/feed')
				&& res.request().method() === 'GET'
				&& res.status() === 200,
			),
			page.locator('#feedRefreshBtn').click(),
		])
		expect(await feedResponse.json()).toHaveProperty('items')
		await expectPostInFeed(page, text)
	})

	test('hashtag search finds published post', async ({ page }) => {
		const tag = `pw${Date.now()}`
		const text = `search-me #${tag}`
		await publishPostViaComposer(page, text)
		await page.locator('#feedSearchInput').fill(`#${tag}`)
		await page.locator('#feedSearchBtn').click()
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#feedList .post-card').filter({ hasText: text })).toBeVisible({
			timeout: 20_000,
		})
	})

	test('search via Enter key', async ({ page }) => {
		const tag = `enter${Date.now()}`
		await publishPostViaComposer(page, `enter-search #${tag}`)
		await page.locator('#feedSearchInput').fill(`#${tag}`)
		await page.locator('#feedSearchInput').press('Enter')
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
	})
})

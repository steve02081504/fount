import { test, expect, openSocialHome, expectPostInFeed, searchAndExpectPost } from './fixtures.mjs'

test.describe('Social feed', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('feed refresh reloads posts', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`refresh-test ${Date.now()}`)
		await expectPostInFeed(page, postId)
		const [feedResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/feed')
				&& res.request().method() === 'GET'
				&& res.status() === 200,
			),
			page.locator('#feedRefreshBtn').click(),
		])
		expect(await feedResponse.json()).toHaveProperty('items')
		await expectPostInFeed(page, postId)
	})

	test('hashtag search finds published post', async ({ page, publishPost }) => {
		const tag = `pw${Date.now()}`
		const { postId } = await publishPost(`search-me #${tag}`)
		await searchAndExpectPost(page, `#${tag}`, postId)
	})

	test('search via Enter key', async ({ page, publishPost }) => {
		const tag = `enter${Date.now()}`
		await publishPost(`enter-search #${tag}`)
		await page.locator('#feedSearchInput').fill(`#${tag}`)
		await page.locator('#feedSearchInput').press('Enter')
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
	})
})

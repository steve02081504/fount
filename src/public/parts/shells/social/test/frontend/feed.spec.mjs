import {
	test,
	expect,
	openSocialHome,
	expectPostInFeed,
	searchAndExpectPost,
	searchViaEnterAndExpectPost,
	waitForFeedLoad,
	findPostCard,
	seedPostsViaApi,
} from './fixtures.mjs'

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
		const { postId } = await publishPost(`enter-search #${tag}`)
		await searchViaEnterAndExpectPost(page, `#${tag}`, postId)
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
	})

	test('short search shows too-short hint', async ({ page }) => {
		await page.locator('#feedSearchInput').fill('a')
		await page.locator('#feedSearchBtn').click()
		await expect(page.locator('#feedList .empty[data-i18n="social.search.tooShort"]')).toBeVisible({ timeout: 20_000 })
	})

	test('trending hashtag link opens search', async ({ page, publishPost }) => {
		const tag = `trend${Date.now()}`
		const { postId } = await publishPost(`trending-a #${tag}`)
		await publishPost(`trending-b #${tag}`)
		await Promise.all([
			waitForFeedLoad(page),
			page.locator('#feedRefreshBtn').click(),
		])
		const trending = page.locator('#feedTrending')
		await expect(trending).toBeVisible({ timeout: 30_000 })
		const tagLink = trending.locator('a.trending-tag', { hasText: `#${tag}` })
		await expect(tagLink).toBeVisible({ timeout: 30_000 })
		await tagLink.click()
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeVisible({ timeout: 30_000 })
	})

	test('search clear restores default feed', async ({ page, publishPost }) => {
		const tag = `clear${Date.now()}`
		const { postId } = await publishPost(`clear-feed #${tag}`)
		await searchAndExpectPost(page, `#${tag}`, postId)
		await page.locator('#feedSearchClearBtn').click()
		await expect(page.locator('#feedSearchInput')).toHaveValue('')
		await expectPostInFeed(page, postId)
	})

	test('feed refresh clears active search', async ({ page, publishPost }) => {
		const tag = `refreshclr${Date.now()}`
		const { postId } = await publishPost(`refresh-clear #${tag}`)
		await searchAndExpectPost(page, `#${tag}`, postId)
		await Promise.all([
			waitForFeedLoad(page),
			page.locator('#feedRefreshBtn').click(),
		])
		await expect(page.locator('#feedSearchInput')).toHaveValue('')
		await expect(page.locator('#feedSearchClearBtn')).toBeHidden()
		await expectPostInFeed(page, postId)
	})

	test('hashtag link in post body opens search', async ({ page, publishPost }) => {
		const tag = `bodytag${Date.now()}`
		const { postId } = await publishPost(`see #${tag} here`)
		const card = await findPostCard(page, postId)
		await card.locator('a[href*="#search"]').filter({ hasText: `#${tag}` }).click()
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toBeVisible({ timeout: 30_000 })
	})

	test('load more fetches next feed page', async ({ page, baseUrl, apiKey }) => {
		await seedPostsViaApi(baseUrl, apiKey, 31, 'loadmore')
		await openSocialHome(page, baseUrl)
		const loadMore = page.locator('#feedLoadMore')
		await expect(loadMore).toBeVisible({ timeout: 60_000 })
		const initialCount = await page.locator('#feedList [data-post-id]').count()
		// 等待含 cursor= 的 load more 请求（区分普通刷新）
		const [feedResponse] = await Promise.all([
			page.waitForResponse(res => {
				if (res.request().method() !== 'GET' || res.status() !== 200) return false
				const url = new URL(res.url())
				return url.pathname === '/api/parts/shells:social/feed' && url.searchParams.has('cursor')
			}, { timeout: 30_000 }),
			loadMore.click(),
		])
		const data = await feedResponse.json()
		expect(data).toHaveProperty('items')
		await expect(page.locator('#feedList [data-post-id]')).not.toHaveCount(initialCount, { timeout: 15_000 })
		const newCount = await page.locator('#feedList [data-post-id]').count()
		expect(newCount).toBeGreaterThan(initialCount)
	})
})

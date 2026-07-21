import {
	test,
	expect,
	openHome,
	expectPostInFeed,
	searchAndExpectPost,
	waitForFeedLoad,
	findPostCard,
	seedPostsViaApi,
} from './fixtures.mjs'

test.describe('Social feed', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openHome(page, baseUrl)
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
			page.locator('#feedRefreshButton').click(),
		])
		expect(await feedResponse.json()).toHaveProperty('items')
		await expectPostInFeed(page, postId)
	})

	test('hashtag search finds published post', async ({ page, publishPost }) => {
		const tag = `pw${Date.now()}`
		const { postId } = await publishPost(`search-me #${tag}`)
		await searchAndExpectPost(page, `#${tag}`, postId)
		await expect(page.locator('#feedSearchClearButton')).toBeVisible({ timeout: 20_000 })
	})

	test('short search shows too-short hint', async ({ page }) => {
		await page.locator('#feedSearchInput').fill('a')
		await page.locator('#feedSearchInput').press('Enter')
		await expect(page.locator('#searchViewResults [data-i18n="social.search.tooShort"]')).toBeVisible({ timeout: 20_000 })
	})

	test('trending hashtag link opens topic view', async ({ page, publishPost }) => {
		const tag = `trend${Date.now()}`
		const { postId } = await publishPost(`trending-a #${tag}`)
		await publishPost(`trending-b #${tag}`)
		await Promise.all([
			waitForFeedLoad(page),
			page.locator('#feedRefreshButton').click(),
		])
		const trending = page.locator('#feedTrending')
		await expect(trending).toBeVisible({ timeout: 30_000 })
		const tagLink = trending.locator('a.trending-tag', { hasText: `#${tag}` })
		await expect(tagLink).toBeVisible({ timeout: 30_000 })
		await tagLink.click()
		await expect(page.locator('#topicView:not(.hidden)')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#topicView .topic-view-title')).toHaveText(`#${tag}`)
		await expect(page.locator(`#topicPostList [data-post-id="${postId}"]`)).toBeVisible({ timeout: 30_000 })
	})

	test('search clear restores default feed', async ({ page, publishPost }) => {
		const tag = `clear${Date.now()}`
		const { postId } = await publishPost(`clear-feed #${tag}`)
		await searchAndExpectPost(page, `#${tag}`, postId)
		await page.locator('#feedSearchClearButton').click()
		await expect(page.locator('#feedSearchInput')).toHaveValue('')
		await expectPostInFeed(page, postId)
	})

	test('navigating to feed clears active search', async ({ page, publishPost }) => {
		const tag = `refreshclr${Date.now()}`
		const { postId } = await publishPost(`refresh-clear #${tag}`)
		await searchAndExpectPost(page, `#${tag}`, postId)
		await Promise.all([
			waitForFeedLoad(page),
			page.locator('.side-nav .nav-btn[data-view="feed"]').click(),
		])
		await expect(page.locator('#feedSearchInput')).toHaveValue('')
		await expect(page.locator('#feedSearchClearButton')).toBeHidden()
		await expectPostInFeed(page, postId)
	})

	test('hashtag link in post body opens topic view', async ({ page, publishPost }) => {
		const tag = `bodytag${Date.now()}`
		const { postId } = await publishPost(`see #${tag} here`)
		const card = await findPostCard(page, postId)
		await card.locator('a[href*="#topic:"]').filter({ hasText: `#${tag}` }).click()
		await expect(page.locator('#topicView:not(.hidden)')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#topicView .topic-view-title')).toHaveText(`#${tag}`)
		await expect(page.locator(`#topicPostList [data-post-id="${postId}"]`)).toBeVisible({ timeout: 30_000 })
	})

	test('long code block stays collapsed and summary does not open detail', async ({ page, publishPost }) => {
		const lines = Array.from({ length: 40 }, (_, i) => `const line${i} = ${i}`).join('\n')
		const { postId } = await publishPost(`\`\`\`js\n${lines}\n\`\`\``)
		const card = await findPostCard(page, postId)
		const details = card.locator('details.markdown-code-block')
		await expect(details).toBeVisible({ timeout: 20_000 })
		await expect(details).not.toHaveAttribute('open')
		const beforeHash = await page.evaluate(() => location.hash)
		await details.locator('summary').click()
		await expect(details).toHaveAttribute('open', '')
		expect(await page.evaluate(() => location.hash)).toBe(beforeHash)
		await expect(page.locator('#postDetailView:not(.hidden)')).toHaveCount(0)
	})

	test('long prose folds in feed and expands in place', async ({ page, publishPost }) => {
		const text = Array.from({ length: 36 }, (_, i) => `fold-line-${i} ${'word '.repeat(12)}`).join('\n\n')
		const { postId } = await publishPost(text)
		const card = await findPostCard(page, postId)
		const body = card.locator('.body.markdown-body').first()
		await expect(body).toHaveClass(/body-foldable/, { timeout: 10_000 })
		await expect(body).not.toHaveClass(/body-expanded/)
		const expand = card.locator('.body-expand')
		await expect(expand).toBeVisible()
		const beforeHash = await page.evaluate(() => location.hash)
		const collapsedHeight = await body.evaluate(el => el.getBoundingClientRect().height)
		await expand.click()
		await expect(body).toHaveClass(/body-expanded/)
		expect(await page.evaluate(() => location.hash)).toBe(beforeHash)
		const expandedHeight = await body.evaluate(el => el.getBoundingClientRect().height)
		expect(expandedHeight).toBeGreaterThan(collapsedHeight)
		await expand.click()
		await expect(body).not.toHaveClass(/body-expanded/)
	})

	test('infinite scroll fetches next feed page', async ({ page, baseUrl, apiKey }) => {
		await seedPostsViaApi(baseUrl, apiKey, 31, 'loadmore')
		// 首屏后会后台预取带 cursor 的下一页；滚动时消费缓存而不再发请求
		const cursorWait = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			const url = new URL(res.url())
			return url.pathname === '/api/parts/shells:social/feed' && url.searchParams.has('cursor')
		}, { timeout: 60_000 })
		await openHome(page, baseUrl)
		await expect(page.locator('#feedScrollSentinel')).toBeAttached({ timeout: 60_000 })
		const initialCount = await page.locator('#feedList [data-post-id]').count()
		const feedResponse = await cursorWait
		expect(await feedResponse.json()).toHaveProperty('items')
		await page.locator('#feedScrollSentinel').scrollIntoViewIfNeeded()
		await expect(page.locator('#feedList [data-post-id]')).not.toHaveCount(initialCount, { timeout: 15_000 })
		const newCount = await page.locator('#feedList [data-post-id]').count()
		expect(newCount).toBeGreaterThan(initialCount)
	})

	test('feed loops replay when cursor exhausted', async ({ page, baseUrl, apiKey }) => {
		await seedPostsViaApi(baseUrl, apiKey, 3, 'replay')
		await openHome(page, baseUrl)
		await expect(page.locator('#feedList [data-post-id]').first()).toBeVisible({ timeout: 60_000 })
		const before = await page.locator('#feedList [data-post-id]').count()
		expect(before).toBeGreaterThan(0)
		await expect(page.locator('#feedScrollSentinel')).toBeAttached({ timeout: 30_000 })
		// 残留帖子可能先分页；持续滚到哨兵直到出现重放分隔线
		for (let i = 0; i < 20; i++) {
			if (await page.locator('.feed-replay-divider').isVisible()) break
			await page.locator('#feedScrollSentinel').scrollIntoViewIfNeeded()
			await page.waitForTimeout(250)
		}
		await expect(page.locator('.feed-replay-divider')).toBeVisible({ timeout: 15_000 })
		// 分隔线先于卡片追加出现；等本轮重放追加完成后再取稳定计数
		await expect(async () => {
			const n = await page.locator('#feedList [data-post-id]').count()
			expect(n).toBeGreaterThan(before)
			await page.waitForTimeout(400)
			expect(await page.locator('#feedList [data-post-id]').count()).toBe(n)
		}).toPass({ timeout: 15_000 })
		const afterReplay = await page.locator('#feedList [data-post-id]').count()
		// 重放完成后计数应稳定，不再因 observer 重绑而死循环膨胀
		await page.waitForTimeout(1500)
		expect(await page.locator('#feedList [data-post-id]').count()).toBe(afterReplay)
	})
})

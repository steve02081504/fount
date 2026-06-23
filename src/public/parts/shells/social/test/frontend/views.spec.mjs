import { test, expect, openSocialHome, findPostCard, fetchViewerEntityHash } from './fixtures.mjs'

test.describe('Social secondary views', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('explore view loads accounts and posts sections', async ({ page }) => {
		const [accountsResponse, postsResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/explore?')
				&& res.status() === 200,
			),
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/explore/posts')
				&& res.status() === 200,
			),
			page.locator('.nav-btn[data-view="explore"]').click(),
		])
		expect(await accountsResponse.json()).toHaveProperty('accounts')
		expect(await postsResponse.json()).toHaveProperty('posts')
		await expect(page.locator('#exploreView')).toBeVisible()
		await expect(page.locator('#exploreView .section-title').first()).toBeVisible()
		await expect(page.locator('#exploreMediaOnly')).toBeVisible()
	})

	test('explore media-only query returns posts payload', async ({ page, baseUrl, apiKey }) => {
		await page.locator('.nav-btn[data-view="explore"]').click()
		await expect(page.locator('#exploreView')).toBeVisible({ timeout: 20_000 })
		const res = await page.request.get(
			`${baseUrl}/api/parts/shells:social/explore/posts?limit=5&mediaOnly=true&fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		expect(res.ok()).toBe(true)
		expect(await res.json()).toHaveProperty('posts')
	})

	test('explore media-only checkbox reloads filtered posts', async ({ page }) => {
		await page.locator('.nav-btn[data-view="explore"]').click()
		await expect(page.locator('#exploreMediaOnly')).toBeVisible({ timeout: 20_000 })
		const [postsResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/explore/posts')
				&& res.url().includes('mediaOnly=true')
				&& res.status() === 200,
			),
			page.locator('#exploreMediaOnly').check(),
		])
		expect(await postsResponse.json()).toHaveProperty('posts')
	})

	test('notifications view loads', async ({ page }) => {
		await page.locator('.nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView')).toBeVisible()
		await expect(page.locator('#notificationsView .empty, #notificationsView .notification-card').first())
			.toBeVisible({ timeout: 20_000 })
	})

	test('reply generates notification', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`notif-parent ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const actionKey = await card.locator('[data-replies]').getAttribute('data-replies')
		await card.locator('[data-replies]').click()
		const panel = page.locator(`[data-replies-for="${actionKey}"]`)
		await panel.locator('textarea').fill(`notif-reply ${Date.now()}`)
		await panel.locator('[data-submit-reply]').click()
		await page.locator('.nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView .notification-card').first())
			.toBeVisible({ timeout: 20_000 })
	})

	test('notifications mark all read button is available', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`markall-parent ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const actionKey = await card.locator('[data-replies]').getAttribute('data-replies')
		await card.locator('[data-replies]').click()
		const panel = page.locator(`[data-replies-for="${actionKey}"]`)
		await panel.locator('textarea').fill(`markall-reply ${Date.now()}`)
		await panel.locator('[data-submit-reply]').click()
		await page.locator('.nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsMarkAllBtn')).toBeVisible({ timeout: 20_000 })
		await page.locator('#notificationsMarkAllBtn').click()
	})

	test('notification badge shows unread count before opening view', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`badge-parent ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const actionKey = await card.locator('[data-replies]').getAttribute('data-replies')
		await card.locator('[data-replies]').click()
		const panel = page.locator(`[data-replies-for="${actionKey}"]`)
		await panel.locator('textarea').fill(`badge-reply ${Date.now()}`)
		await panel.locator('[data-submit-reply]').click()
		await expect(page.locator('#notificationsBadge:not(.hidden)')).toBeVisible({ timeout: 30_000 })
	})

	test('explore post link opens profile', async ({ page, publishPost }) => {
		const snippet = `explore-link ${Date.now()}`
		await publishPost(snippet)
		await page.locator('.nav-btn[data-view="explore"]').click()
		await expect(page.locator('#exploreView .explore-post-card').first()).toBeVisible({ timeout: 30_000 })
		const postCard = page.locator('#exploreView .explore-post-card', { hasText: snippet }).first()
		await expect(postCard).toBeVisible({ timeout: 30_000 })
		await postCard.locator('a.link-btn').first().click()
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 20_000 })
	})

	test('explore account link opens profile after blurb saved', async ({ page, baseUrl, apiKey }) => {
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const blurb = `explore-visible ${Date.now()}`
		await page.locator('.nav-btn[data-view="profile"]').click()
		await page.locator('#exploreBlurbInput').fill(blurb)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/meta')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#saveMetaBtn').click(),
		])
		await page.locator('.nav-btn[data-view="explore"]').click()
		const accountRow = page.locator('#exploreView .explore-account', { hasText: blurb })
		await expect(accountRow).toBeVisible({ timeout: 30_000 })
		await accountRow.locator(`a[href*="${entityHash}"]`).click()
		await expect(page.locator('#profileView .profile-card')).toBeVisible({ timeout: 20_000 })
	})
})

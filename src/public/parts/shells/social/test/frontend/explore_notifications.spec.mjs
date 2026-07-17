import { waitForSocialAppReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openSocialHome,
	fetchViewerEntityHash,
	injectForeignLike,
	seedInboxLikes,
	seedInboxMentions,
} from './fixtures.mjs'

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
			page.locator('.side-nav .nav-btn[data-view="explore"]').click(),
		])
		expect(await accountsResponse.json()).toHaveProperty('accounts')
		expect(await postsResponse.json()).toHaveProperty('posts')
		await expect(page.locator('#exploreView')).toBeVisible()
		await expect(page.locator('#exploreView .section-title').first()).toBeVisible()
		await expect(page.locator('#exploreMediaOnly')).toBeVisible()
	})

	test('explore media-only query returns posts payload', async ({ page, baseUrl, apiKey }) => {
		await page.locator('.side-nav .nav-btn[data-view="explore"]').click()
		await expect(page.locator('#exploreView')).toBeVisible({ timeout: 20_000 })
		const res = await page.request.get(
			`${baseUrl}/api/parts/shells:social/explore/posts?limit=5&mediaOnly=true&fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		expect(res.ok()).toBe(true)
		expect(await res.json()).toHaveProperty('posts')
	})

	test('explore media-only checkbox reloads filtered posts', async ({ page }) => {
		await page.locator('.side-nav .nav-btn[data-view="explore"]').click()
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
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView')).toBeVisible()
		await expect(page.locator('#notificationsView .empty, #notificationsView .notification-card').first())
			.toBeVisible({ timeout: 20_000 })
	})

	test('notifications view loads inbox tabs', async ({ page }) => {
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView')).toBeVisible()
		await expect(page.locator('.inbox-filter-tabs [data-notif-filter="all"]')).toBeVisible()
		await expect(page.locator('.inbox-filter-tabs [data-notif-filter="like"]')).toBeVisible()
	})

	test('like generates notification', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`notif-parent ${Date.now()}`)
		await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView .notification-card').first())
			.toBeVisible({ timeout: 20_000 })
	})

	test('notification view link opens post detail', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`notif-link ${Date.now()}`)
		await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		await page.locator('.side-nav .nav-btn[data-view="feed"]').click()
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		const notifCard = page.locator('#notificationsView .notification-card').first()
		await expect(notifCard).toBeVisible({ timeout: 30_000 })
		await notifCard.locator('a.notification-view-link').click()
		await expect(page.locator('#postDetailView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#postDetailView [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('notifications mark all read clears badge', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`markall-parent ${Date.now()}`)
		await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsMarkAllButton')).toBeVisible({ timeout: 20_000 })
		await page.locator('#notificationsMarkAllButton').click()
		await expect(page.locator('#notificationsBadge')).toHaveClass(/hidden/, { timeout: 20_000 })
	})

	test('notification badge shows unread count before opening view', async ({ page, baseUrl, publishPost, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`badge-parent ${Date.now()}`)
		await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		await page.goto(`${baseUrl}/parts/shells:social/`, { waitUntil: 'domcontentloaded' })
		await waitForSocialAppReady(page)
		await expect(page.locator('#notificationsBadge:not(.hidden)')).toBeVisible({ timeout: 10_000 })
	})

	test('inbox like tab filters notifications', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`tab-like ${Date.now()}`)
		await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		await seedInboxMentions(baseUrl, apiKey, 1)
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView .notification-card').first()).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#notificationsView .notification-card .s-ic-notif-mention').first()).toBeVisible()
		await Promise.all([
			page.waitForResponse(res => {
				const url = new URL(res.url())
				return url.pathname === '/api/parts/shells:social/notifications'
					&& url.searchParams.get('types') === 'like'
					&& res.status() === 200
			}),
			page.locator('.inbox-filter-tabs [data-notif-filter="like"]').click(),
		])
		await expect(page.locator('#notificationsView .notification-card .s-ic-notif-mention')).toHaveCount(0)
		await expect(page.locator('#notificationsView .notification-card .s-ic-notif-like').first()).toBeVisible()
		await expect(page.locator('#notificationsView .notification-card', {
			has: page.locator(`a.notification-view-link[href*="${postId}"]`),
		}).first()).toBeVisible()
	})

	test('aggregated like copy shows actor count', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`agg-like ${Date.now()}`)
		await seedInboxLikes(baseUrl, apiKey, viewerEntityHash, postId, 2)
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		const card = page.locator('#notificationsView .notification-card', {
			has: page.locator(`a.notification-view-link[href*="${postId}"]`),
		}).first()
		await expect(card).toBeVisible({ timeout: 20_000 })
		await expect(card).toHaveAttribute('data-actor-count', '2')
		await expect(card.locator('.notification-type')).toContainText('和')
	})

	test('notification snippet is visible on inbox card', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`snippet-parent ${Date.now()}`)
		await seedInboxLikes(baseUrl, apiKey, viewerEntityHash, postId, 1)
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		const card = page.locator('#notificationsView .notification-card', {
			has: page.locator(`a.notification-view-link[href*="${postId}"]`),
		}).first()
		await expect(card).toBeVisible({ timeout: 20_000 })
		await expect(card.locator('.notification-snippet')).toContainText('aggregated like target')
	})

	test('WS notification merges into existing aggregated card', async ({ page, publishPost, baseUrl, apiKey }) => {
		const viewerEntityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`ws-merge ${Date.now()}`)
		await seedInboxLikes(baseUrl, apiKey, viewerEntityHash, postId, 1)
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		const cardForPost = page.locator('#notificationsView .notification-card', {
			has: page.locator(`a.notification-view-link[href*="${postId}"]`),
		})
		await expect(cardForPost.first()).toBeVisible({ timeout: 20_000 })
		await expect(cardForPost.first()).toHaveAttribute('data-actor-count', '1')
		await injectForeignLike(baseUrl, apiKey, viewerEntityHash, postId)
		await expect(cardForPost.first()).toHaveAttribute('data-actor-count', '2', { timeout: 20_000 })
		await expect(cardForPost).toHaveCount(1)
	})

	test('notifications infinite scroll loads next page', async ({ page, baseUrl, apiKey }) => {
		await seedInboxMentions(baseUrl, apiKey, 41)
		// rootMargin 可能在首屏 bind 后立刻拉下一页；也覆盖需滚动才触发的情况
		const cursorWait = page.waitForResponse(res => {
			if (res.request().method() !== 'GET' || res.status() !== 200) return false
			const url = new URL(res.url())
			return url.pathname === '/api/parts/shells:social/notifications' && url.searchParams.has('cursor')
		}, { timeout: 60_000 })
		await page.locator('.side-nav .nav-btn[data-view="notifications"]').click()
		await expect(page.locator('#notificationsView .notification-card').first())
			.toBeVisible({ timeout: 30_000 })
		await page.locator('#notificationsScrollSentinel').scrollIntoViewIfNeeded()
		expect(await (await cursorWait).json()).toHaveProperty('notifications')
		// 首页 limit=40；第二页到达后总数应超过首页
		await expect.poll(
			() => page.locator('#notificationsView .notification-card').count(),
			{ timeout: 15_000 },
		).toBeGreaterThan(40)
	})

	test('explore post link opens profile', async ({ page, publishPost }) => {
		const snippet = `explore-link ${Date.now()}`
		await publishPost(snippet)
		await page.locator('.side-nav .nav-btn[data-view="explore"]').click()
		await expect(page.locator('#exploreView .explore-post-card').first()).toBeVisible({ timeout: 30_000 })
		const postCard = page.locator('#exploreView .explore-post-card', { hasText: snippet }).first()
		await expect(postCard).toBeVisible({ timeout: 30_000 })
		await postCard.locator('a.author-name').click()
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 20_000 })
	})

	test('explore post author opens profile after ensure discoverable', async ({ page, publishPost }) => {
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-profile-settings]').click()
		await expect(page.locator('#settingsView')).toBeVisible({ timeout: 20_000 })
		const protectedInput = page.locator('#exploreProtectedInput')
		await expect(protectedInput).toBeVisible({ timeout: 10_000 })
		// 先前用例可能把 hideFromDiscovery 拨成 true；保存 meta 会原样写回，导致探索页看不到新帖
		if (await protectedInput.isChecked())
			await Promise.all([
				page.waitForResponse(res =>
					res.url().includes('/api/parts/shells:social/profile/meta')
					&& res.request().method() === 'POST'
					&& res.status() === 200,
				),
				protectedInput.setChecked(false),
			])
		await page.locator('#settingsView [data-view="profile"]').click()
		const snippet = `explore-visible-post ${Date.now()}`
		await page.locator('.side-nav .nav-btn[data-view="feed"]').click()
		await publishPost(snippet)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/explore/posts')
				&& res.status() === 200,
			),
			page.locator('.side-nav .nav-btn[data-view="explore"]').click(),
		])
		const postCard = page.locator('#exploreView .explore-post-card', { hasText: snippet }).first()
		await expect(postCard).toBeVisible({ timeout: 30_000 })
		await postCard.locator('a.author-name').click()
		await expect(page.locator('#profileView .profile-header')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profileEntityCardHost .hub-profile-popup')).toBeVisible()
	})
})

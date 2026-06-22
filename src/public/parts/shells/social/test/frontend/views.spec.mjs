import { test, expect, openSocialHome, findPostCard } from './fixtures.mjs'

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

	test('explore media-only toggle refetches', async ({ page }) => {
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
})

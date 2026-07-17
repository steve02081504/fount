import { waitForSocialAppReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openSocialHome,
	postIdFromResponse,
	fetchViewerEntityHash,
	waitForPostMaterialized,
	DUMMY_ENTITY_HASH,
} from './fixtures.mjs'

test.describe('Social profile', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('profile view shows own posts', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`profile-post ${Date.now()}`)
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('#profileView')).toBeVisible()
		await expect(page.locator('#profileView .profile-header')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profileView #profileEntityCardHost .hub-profile-popup')).toBeVisible()
		await expect(page.locator('#profileView .hub-profile-popup-banner.entity-profile-banner')).toBeVisible()
		await expect(page.locator(`#profilePostsPanel [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('[data-profile-stat="following"]')).toBeVisible()
		await expect(page.locator('[data-profile-stat="followers"]')).toBeVisible()
		await expect(page.locator('[data-profile-tab="following"]')).toHaveCount(0)
	})

	test('profile likes tab shows liked posts', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`like-tab-src ${Date.now()}`)
		const card = page.locator(`#feedList [data-post-id="${postId}"]`)
		await expect(card).toBeVisible({ timeout: 30_000 })
		await card.locator('[data-like]').click()
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await page.locator('[data-profile-tab="likes"]').click()
		await expect(page.locator('#profileLikesPanel')).toBeVisible()
		await expect(page.locator(`#profileLikesPanel [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('profile settings view saves hideFromDiscovery', async ({ page }) => {
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('[data-profile-edit]')).toBeVisible()
		await page.locator('[data-profile-settings]').click()
		await expect(page.locator('#settingsView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('.side-nav .nav-btn[data-view="taste"]')).toHaveCount(0)
		const protectedInput = page.locator('#exploreProtectedInput')
		await expect(protectedInput).toBeVisible({ timeout: 10_000 })
		const wasProtected = await protectedInput.isChecked()
		const [metaResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/meta')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			protectedInput.setChecked(!wasProtected),
		])
		const metaJson = await metaResponse.json()
		expect(metaJson).toHaveProperty('socialMeta')
		expect(metaJson.socialMeta?.hideFromDiscovery).toBe(!wasProtected)
	})

	test('deep link opens profile with highlighted post', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postJson, postId } = await publishPost(`deeplink ${Date.now()}`)
		expect(postIdFromResponse(postJson)).toBe(postId)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await waitForPostMaterialized(baseUrl, apiKey, postId)
		await Promise.all([
			page.goto(`${baseUrl}/parts/shells:social/#profile;${entityHash};${postId}`),
			page.waitForResponse(res =>
				res.url().includes(`/api/parts/shells:social/profile/${entityHash}/posts`)
				&& res.request().method() === 'GET'
				&& res.status() === 200,
			),
		])
		await waitForSocialAppReady(page)
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 30_000 })
		const highlighted = page.locator(`#profileView [data-post-id="${postId}"].highlight-post`)
		await expect(highlighted).toBeVisible({ timeout: 30_000 })
		await expect(highlighted).toHaveClass(/highlight-post/)
	})

	test('follow and unfollow seeded target smoke', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialAppReady(page)
		const followButton = page.locator(`[data-follow="${dummy}"]`)
		await expect(followButton).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/follow')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			followButton.click(),
		])
		await expect(followButton).toHaveAttribute('data-is-following', '1', { timeout: 20_000 })
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-profile-stat="following"]').click()
		await expect(page.locator('#profileRelationshipList .following-link')).toContainText(dummy.slice(0, 8), { timeout: 20_000 })
		await page.goto(`${baseUrl}/parts/shells:social/`)
		await waitForSocialAppReady(page)
		await page.evaluate(eh => { window.location.hash = `profile;${eh}` }, dummy)
		const unfollowButton = page.locator(`[data-follow="${dummy}"]`)
		await expect(unfollowButton).toBeVisible({ timeout: 30_000 })
		await expect(unfollowButton).toHaveAttribute('data-is-following', '1', { timeout: 10_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/follow')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			{ timeout: 60_000 }),
			unfollowButton.click(),
		])
		await expect(unfollowButton).toHaveAttribute('data-is-following', '0', { timeout: 20_000 })
	})

	test('dm button navigates to chat contact link smoke', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialAppReady(page)
		await page.locator(`[data-dm="${dummy}"]`).click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/hub/\\?contact=${dummy}`),
			{ timeout: 20_000 },
		)
	})

	test('blocklist shows blocked entity and unblocks smoke', async ({ page, baseUrl, apiKey }) => {
		const dummy = DUMMY_ENTITY_HASH
		const blockRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/relationships/block?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash: dummy, block: true } },
		)
		expect(blockRes.ok()).toBe(true)
		await page.locator('.side-nav .nav-btn[data-view="profile"]').click()
		await expect(page.locator('[data-profile-settings]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-profile-settings]').click()
		await expect(page.locator('#settingsView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#blocklistSection [data-unblock="${dummy}"]`)).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/block')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator(`[data-unblock="${dummy}"]`).click(),
		])
		await expect(page.locator(`[data-unblock="${dummy}"]`)).toHaveCount(0, { timeout: 20_000 })
	})
})

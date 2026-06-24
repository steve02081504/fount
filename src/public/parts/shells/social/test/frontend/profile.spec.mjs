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
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#profileView')).toBeVisible()
		await expect(page.locator('#profileView .profile-card')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#profileView [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('profile explore settings save', async ({ page }) => {
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#exploreBlurbInput')).toBeVisible({ timeout: 20_000 })
		const blurb = `explore-blurb ${Date.now()}`
		await page.locator('#exploreBlurbInput').fill(blurb)
		const protectedInput = page.locator('#exploreProtectedInput')
		const wasProtected = await protectedInput.isChecked()
		await protectedInput.setChecked(!wasProtected)
		const [metaResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/meta')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#saveMetaBtn').click(),
		])
		const metaJson = await metaResponse.json()
		expect(metaJson).toHaveProperty('socialMeta')
		expect(metaJson.socialMeta?.isProtected).toBe(!wasProtected)
		await expect(page.locator('#exploreBlurbInput')).toHaveValue(blurb)
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

	test('follow and unfollow other profile', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialAppReady(page)
		const followBtn = page.locator(`[data-follow="${dummy}"]`)
		await expect(followBtn).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/follow')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			followBtn.click(),
		])
		await expect(followBtn).toHaveAttribute('data-is-following', '1', { timeout: 20_000 })
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#profileView .profile-following')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profileView .following-link')).toContainText(dummy.slice(0, 8))
		// page.goto 到相同 URL hash 时浏览器不会重新加载，无法触发 applyIncomingNavigation
		// 先导航到无 hash 的社交首页（触发完整重载），再设置 hash（触发 hashchange）
		await page.goto(`${baseUrl}/parts/shells:social/`)
		await waitForSocialAppReady(page)
		await page.evaluate(eh => { window.location.hash = `profile;${eh}` }, dummy)
		const unfollowBtn = page.locator(`[data-follow="${dummy}"]`)
		await expect(unfollowBtn).toBeVisible({ timeout: 30_000 })
		await expect(unfollowBtn).toHaveAttribute('data-is-following', '1', { timeout: 10_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/follow')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			{ timeout: 60_000 }),
			unfollowBtn.click(),
		])
		await expect(unfollowBtn).toHaveAttribute('data-is-following', '0', { timeout: 20_000 })
	})

	test('dm button navigates to chat contact link', async ({ page, baseUrl }) => {
		const dummy = DUMMY_ENTITY_HASH
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${dummy}`)
		await waitForSocialAppReady(page)
		await page.locator(`[data-dm="${dummy}"]`).click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/hub/\\?contact=${dummy}`),
			{ timeout: 20_000 },
		)
	})

	test('blocklist shows blocked entity and unblocks', async ({ page, baseUrl, apiKey }) => {
		const dummy = DUMMY_ENTITY_HASH
		const blockRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/profile/block?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash: dummy, block: true } },
		)
		expect(blockRes.ok()).toBe(true)
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#blocklistSection code.entity-hash')).toContainText(
			dummy.slice(0, 16),
			{ timeout: 20_000 },
		)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/block')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator(`[data-unblock="${dummy}"]`).click(),
		])
		await expect(page.locator(`[data-unblock="${dummy}"]`)).toHaveCount(0, { timeout: 20_000 })
	})
})

import {
	test,
	expect,
	openSocialHome,
	publishPostViaComposer,
	expectPostInFeed,
	fetchViewerEntityHash,
} from './fixtures.mjs'

test.describe('Social profile', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('profile view shows own posts', async ({ page }) => {
		const text = `profile-post ${Date.now()}`
		await publishPostViaComposer(page, text)
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#profileView')).toBeVisible()
		await expect(page.locator('#profileView .profile-card')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('#profileView .profile-posts .post-card').filter({ hasText: text }))
			.toBeVisible({ timeout: 20_000 })
	})

	test('profile explore settings save', async ({ page }) => {
		await page.locator('.nav-btn[data-view="profile"]').click()
		await expect(page.locator('#exploreBlurbInput')).toBeVisible({ timeout: 20_000 })
		const blurb = `explore-blurb ${Date.now()}`
		await page.locator('#exploreBlurbInput').fill(blurb)
		const [metaResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/meta')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#saveMetaBtn').click(),
		])
		expect(await metaResponse.json()).toHaveProperty('saved')
		await expect(page.locator('#exploreBlurbInput')).toHaveValue(blurb)
	})

	test('deep link opens profile with highlighted post', async ({ page, baseUrl, apiKey }) => {
		const text = `deeplink ${Date.now()}`
		const postJson = await publishPostViaComposer(page, text)
		const postId = postJson.event?.postId
		expect(postId).toBeTruthy()
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await page.goto(`${baseUrl}/parts/shells:social/#profile/${entityHash}/${postId}`)
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator(`[data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`[data-post-id="${postId}"]`)).toHaveClass(/highlight-post/)
	})
})

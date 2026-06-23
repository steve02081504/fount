import {
	test,
	expect,
	openSocialHome,
	postIdFromResponse,
	fetchViewerEntityHash,
	waitForPostMaterialized,
	waitForSocialReady,
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
		const [metaResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/meta')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#saveMetaBtn').click(),
		])
		expect(await metaResponse.json()).toHaveProperty('socialMeta')
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
		await waitForSocialReady(page)
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 30_000 })
		const highlighted = page.locator(`#profileView [data-post-id="${postId}"].highlight-post`)
		await expect(highlighted).toBeVisible({ timeout: 30_000 })
		await expect(highlighted).toHaveClass(/highlight-post/)
	})
})

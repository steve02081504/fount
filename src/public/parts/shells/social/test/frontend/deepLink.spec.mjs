import {
	test,
	expect,
	openSocialHome,
	searchAndExpectPost,
	fetchViewerEntityHash,
} from './fixtures.mjs'

test.describe('Social deep links', () => {
	test('hash search opens feed search', async ({ page, baseUrl, publishPost }) => {
		await openSocialHome(page, baseUrl)
		const tag = `hashsearch${Date.now()}`
		const { postId } = await publishPost(`hash link #${tag}`)
		await page.goto(`${baseUrl}/parts/shells:social/#search;${encodeURIComponent(tag)}`)
		await expect(page.locator('#feedView')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
		await searchAndExpectPost(page, `#${tag}`, postId)
	})

	test('query param q opens search', async ({ page, baseUrl, publishPost }) => {
		await openSocialHome(page, baseUrl)
		const tag = `qparam${Date.now()}`
		await publishPost(`query search #${tag}`)
		await page.goto(`${baseUrl}/parts/shells:social/?q=${encodeURIComponent(`#${tag}`)}`)
		await expect(page.locator('#feedSearchClearBtn')).toBeVisible({ timeout: 20_000 })
	})

	test('profile hash without post id', async ({ page, baseUrl, apiKey }) => {
		await openSocialHome(page, baseUrl)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await page.goto(`${baseUrl}/parts/shells:social/#profile;${entityHash}`)
		await expect(page.locator('#profileView .profile-card')).toBeVisible({ timeout: 30_000 })
	})
})

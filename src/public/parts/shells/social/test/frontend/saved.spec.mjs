import { test, expect, openSocialHome, findPostCard, fetchViewerEntityHash } from './fixtures.mjs'

test.describe('Social saved posts', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('saved view lists bookmarked post', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postId } = await publishPost(`saved-item ${Date.now()}`)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const saveRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/saved-posts/add?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash, postId } },
		)
		expect(saveRes.ok()).toBe(true)
		await page.locator('.nav-btn[data-view="saved"]').click()
		await expect(page.locator('#savedView')).toBeVisible()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('create folder and save into it', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postId } = await publishPost(`folder-save ${Date.now()}`)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await findPostCard(page, postId)
		await page.locator('.nav-btn[data-view="saved"]').click()
		const folderName = `folder-${Date.now()}`
		await page.locator('#newFolderName').fill(folderName)
		const [folderResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/folders')
				&& res.request().method() === 'POST',
				{ timeout: 60_000 },
			),
			page.locator('#createFolderBtn').click(),
		])
		expect(folderResponse.ok()).toBe(true)
		const folderJson = await folderResponse.json()
		const folderId = Object.keys(folderJson.folders || {}).find(
			id => folderJson.folders[id]?.name === folderName,
		)
		expect(folderId).toBeTruthy()
		await expect(page.locator('#savedView').filter({ hasText: folderName })).toBeVisible()
		const saveRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/saved-posts/add?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash, postId, folderId } },
		)
		expect(saveRes.ok()).toBe(true)
		await page.locator('.nav-btn[data-view="saved"]').click()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})
})

import { test, expect, openSocialHome, expectPostInFeed, fetchViewerEntityHash } from './fixtures.mjs'

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
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		await expect(page.locator('#savedView')).toBeVisible()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('create folder and save into it', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postId } = await publishPost(`folder-save ${Date.now()}`)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		await expectPostInFeed(page, postId)
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		const folderName = `folder-${Date.now()}`
		await page.locator('#newFolderName').fill(folderName)
		const [folderResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/folders')
				&& res.request().method() === 'POST',
			{ timeout: 60_000 },
			),
			page.locator('#createFolderButton').click(),
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
		await page.locator('.side-nav .nav-btn[data-view="feed"]').click()
		const [savedLoad] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts')
				&& res.request().method() === 'GET'
				&& res.status() === 200,
			),
			page.locator('.side-nav .nav-btn[data-view="saved"]').click(),
		])
		expect(savedLoad.ok()).toBe(true)
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('saved link opens profile with post', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postId } = await publishPost(`saved-link ${Date.now()}`)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const saveRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/saved-posts/add?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash, postId } },
		)
		expect(saveRes.ok()).toBe(true)
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		await page.locator(`#savedView a[href*="${postId}"]`).click()
		await expect(page.locator('#profileView')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator(`#profileView [data-post-id="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('remove saved post from unfiled list', async ({ page, baseUrl, apiKey, publishPost }) => {
		const { postId } = await publishPost(`remove-saved ${Date.now()}`)
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const saveRes = await page.request.post(
			`${baseUrl}/api/parts/shells:social/saved-posts/add?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { entityHash, postId } },
		)
		expect(saveRes.ok()).toBe(true)
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
		await page.locator(`#savedView .saved-row:has(a[href*="${postId}"]) [data-remove-saved]`).click()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toHaveCount(0, { timeout: 20_000 })
	})

	test('rename and delete saved folder', async ({ page }) => {
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		const folderName = `rename-folder-${Date.now()}`
		await page.locator('#newFolderName').fill(folderName)
		const [folderResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/folders')
				&& res.request().method() === 'POST',
			),
			page.locator('#createFolderButton').click(),
		])
		const folderJson = await folderResponse.json()
		const folderId = Object.keys(folderJson.folders || {}).find(
			id => folderJson.folders[id]?.name === folderName,
		)
		expect(folderId).toBeTruthy()
		const renamed = `renamed-${Date.now()}`
		await page.locator(`[data-rename-folder="${folderId}"]`).click()
		const promptDialog = page.locator('dialog.modal').last()
		await expect(promptDialog).toBeVisible({ timeout: 20_000 })
		await promptDialog.locator('#promptInput').fill(renamed)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/folders/rename')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			promptDialog.locator('[data-dialog-resolve]').click(),
		])
		await expect(page.locator('#savedView').filter({ hasText: renamed })).toBeVisible({ timeout: 20_000 })
		await page.locator(`[data-delete-folder="${folderId}"]`).click()
		const confirmDialog = page.locator('dialog.modal').last()
		await expect(confirmDialog).toBeVisible({ timeout: 20_000 })
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/folders/delete')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			confirmDialog.locator('[data-dialog-resolve]').click(),
		])
		await expect(page.locator('#savedView').filter({ hasText: renamed })).toHaveCount(0, { timeout: 20_000 })
	})
})

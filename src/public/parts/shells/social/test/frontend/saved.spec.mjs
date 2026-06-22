import { test, expect, openSocialHome, findPostCard } from './fixtures.mjs'

test.describe('Social saved posts', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('saved view lists bookmarked post', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`saved-item ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('[data-save]').click()
		await page.locator('#saveConfirmBtn').click()
		await page.locator('.nav-btn[data-view="saved"]').click()
		await expect(page.locator('#savedView')).toBeVisible()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('create folder and save into it', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`folder-save ${Date.now()}`)
		await findPostCard(page, postId)
		await page.locator('.nav-btn[data-view="saved"]').click()
		const folderName = `folder-${Date.now()}`
		await page.locator('#newFolderName').fill(folderName)
		const [folderResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/folders')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#createFolderBtn').click(),
		])
		expect(await folderResponse.json()).toHaveProperty('folderId')
		await expect(page.locator('#savedView').filter({ hasText: folderName })).toBeVisible()
		await page.locator('.nav-btn[data-view="feed"]').click()
		const card = await findPostCard(page, postId)
		await card.locator('[data-save]').click()
		await page.locator('#saveFolderSelect').selectOption({ label: folderName })
		await page.locator('#saveConfirmBtn').click()
		await page.locator('.nav-btn[data-view="saved"]').click()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})
})

import {
	test,
	expect,
	openSocialHome,
	publishPostViaComposer,
	expectPostInFeed,
} from './fixtures.mjs'

test.describe('Social saved posts', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('saved view lists bookmarked post', async ({ page }) => {
		const text = `saved-item ${Date.now()}`
		await publishPostViaComposer(page, text)
		const card = await expectPostInFeed(page, text)
		await card.locator('[data-save]').click()
		await page.locator('#saveConfirmBtn').click()
		await page.locator('.nav-btn[data-view="saved"]').click()
		await expect(page.locator('#savedView')).toBeVisible()
		await expect(page.locator('#savedView').filter({ hasText: text })).toBeVisible({ timeout: 20_000 })
	})

	test('create folder and save into it', async ({ page }) => {
		const text = `folder-save ${Date.now()}`
		const folderName = `folder-${Date.now()}`
		await publishPostViaComposer(page, text)
		const card = await expectPostInFeed(page, text)
		await page.locator('.nav-btn[data-view="saved"]').click()
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
		const feedCard = page.locator('#feedList .post-card').filter({ hasText: text }).first()
		await feedCard.locator('[data-save]').click()
		await page.locator('#saveFolderSelect').selectOption({ label: folderName })
		await page.locator('#saveConfirmBtn').click()
		await page.locator('.nav-btn[data-view="saved"]').click()
		await expect(page.locator('#savedView').filter({ hasText: text })).toBeVisible({ timeout: 20_000 })
	})
})

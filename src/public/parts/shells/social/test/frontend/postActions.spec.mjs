import { test, expect, openSocialHome, findPostCard, openPostMoreMenu, findForeignAuthorPostCard, FOREIGN_FE_AUTHOR_HASH } from './fixtures.mjs'

test.describe('Social post actions', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('dm from post card navigates to chat', async ({ page, baseUrl, apiKey }) => {
		const card = await findForeignAuthorPostCard(page, baseUrl, apiKey)
		await openPostMoreMenu(card)
		await card.locator(`[data-dm="${FOREIGN_FE_AUTHOR_HASH}"]`).click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/hub/\\?contact=${FOREIGN_FE_AUTHOR_HASH}`),
			{ timeout: 20_000 },
		)
	})

	test('like and unlike toggle', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`like-toggle ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const likeButton = card.locator('.like-btn')
		await likeButton.click()
		await expect(likeButton).toHaveAttribute('data-liked', '1', { timeout: 20_000 })
		await likeButton.click()
		await expect(likeButton).toHaveAttribute('data-liked', '0', { timeout: 20_000 })
	})

	test('submit repost appears in feed', async ({ page, publishPost }) => {
		const { postId: originalId } = await publishPost(`repost-src ${Date.now()}`)
		const card = await findPostCard(page, originalId, { allowProfileFallback: true })
		const repostKey = await card.locator('[data-repost]').getAttribute('data-repost')
		const panel = card.locator(`[data-repost-for="${repostKey}"]`)
		await card.locator('[data-repost]').click()
		const comment = `repost-comment ${Date.now()}`
		await panel.locator('textarea').fill(comment)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/posts/')
				&& res.url().includes('/repost')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			panel.locator('[data-submit-repost]').click(),
		])
		await expect(panel).toHaveClass(/hidden/)
		await page.locator('#feedRefreshButton').click()
		await expect(page.locator('#feedList .repost-comment', { hasText: comment })).toBeVisible({ timeout: 30_000 })
	})

	test('translate appends translated text block', async ({ page, publishPost }) => {
		const source = `translate-me-${Date.now()}`
		const { postId } = await publishPost(source)
		const card = await findPostCard(page, postId)
		await openPostMoreMenu(card)
		const translateRes = page.waitForResponse(res =>
			res.url().includes('/api/parts/shells:social/translate')
			&& res.request().method() === 'POST'
			&& res.status() === 200,
		)
		await card.locator('[data-translate]').click()
		const res = await translateRes
		const body = await res.json()
		if (body.translated && body.translated !== source)
			await expect(card.locator('.translation-block')).toContainText(body.translated, { timeout: 20_000 })
		else
			await expect(card.locator('.translation-block')).toBeVisible({ timeout: 20_000 })
	})

	test('save modal confirm bookmarks post', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`modal-save ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('[data-save]').click()
		await expect(page.locator('#saveModal')).toBeVisible({ timeout: 20_000 })
		await page.locator('#saveConfirmButton').click()
		await expect(page.locator('#saveModal')).toBeHidden({ timeout: 10_000 })
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('hide removes foreign author posts optimistically', async ({ page, baseUrl, apiKey }) => {
		const card = await findForeignAuthorPostCard(page, baseUrl, apiKey)
		await openPostMoreMenu(card)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/relationships/hide')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			card.locator('[data-hide]').click(),
		])
		await expect(page.locator(`#feedList .post-card[data-author-entity="${FOREIGN_FE_AUTHOR_HASH}"]`))
			.toHaveCount(0, { timeout: 10_000 })
	})

	test('delete removes own post optimistically', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`delete-opt ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await openPostMoreMenu(card)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/posts')
				&& res.request().method() === 'DELETE'
				&& res.status() === 200,
			),
			card.locator('[data-delete]').click(),
		])
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toHaveCount(0, { timeout: 10_000 })
	})
})

import { test, expect, openSocialHome, findPostCard } from './fixtures.mjs'

test.describe('Social post actions', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('like toggles on own post', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`like-test ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const likeBtn = card.locator('.like-btn')
		await expect(likeBtn).toHaveAttribute('data-liked', '0')
		const [likeResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/like')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			likeBtn.click(),
		])
		expect(await likeResponse.json()).toHaveProperty('liked')
		await expect(card.locator('.like-btn')).toHaveAttribute('data-liked', '1')
	})

	test('delete removes own post', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`delete-test ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const [deleteResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/post-delete')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			card.locator('[data-delete]').click(),
		])
		expect(await deleteResponse.json()).toHaveProperty('deleted')
		await expect(page.locator(`[data-post-id="${postId}"]`)).toHaveCount(0, { timeout: 20_000 })
	})

	test('repost panel toggles', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`repost-panel ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const repostBtn = card.locator('[data-repost]')
		const actionKey = await repostBtn.getAttribute('data-repost')
		const panel = page.locator(`[data-repost-for="${actionKey}"]`)
		await expect(panel).toHaveClass(/hidden/)
		await repostBtn.click()
		await expect(panel).not.toHaveClass(/hidden/)
		await repostBtn.click()
		await expect(panel).toHaveClass(/hidden/)
	})

	test('replies panel loads', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`replies-panel ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const repliesBtn = card.locator('[data-replies]')
		const actionKey = await repliesBtn.getAttribute('data-replies')
		const panel = page.locator(`[data-replies-for="${actionKey}"]`)
		await repliesBtn.click()
		await expect(panel).not.toHaveClass(/hidden/)
	})

	test('reply submits and appears in panel', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`reply-target ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const repliesBtn = card.locator('[data-replies]')
		const actionKey = await repliesBtn.getAttribute('data-replies')
		await repliesBtn.click()
		const panel = page.locator(`[data-replies-for="${actionKey}"]`)
		const replyText = `reply-body ${Date.now()}`
		await panel.locator('textarea').fill(replyText)
		const [replyResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/post')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			panel.locator('[data-submit-reply]').click(),
		])
		expect((await replyResponse.json()).event?.content?.text).toBe(replyText)
		await expect(panel).toContainText(replyText, { timeout: 20_000 })
	})

	test('save modal opens and confirms', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`save-test ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('[data-save]').click()
		await expect(page.locator('#saveModal')).toBeVisible()
		const [saveResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/saved-posts/add')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#saveConfirmBtn').click(),
		])
		expect(await saveResponse.json()).toHaveProperty('saved')
		await expect(page.locator('#saveModal')).toHaveClass(/hidden/)
	})

	test('copy link updates button label', async ({ page, publishPost, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		const { postId } = await publishPost(`copy-link ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const copyBtn = card.locator('[data-copy-link]')
		const labelBefore = await copyBtn.textContent()
		await copyBtn.click()
		await expect(copyBtn).not.toHaveText(labelBefore || '', { timeout: 5_000 })
	})
})

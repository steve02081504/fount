import { test, expect, openSocialHome, findPostCard, fetchViewerEntityHash, openPostMoreMenu } from './fixtures.mjs'

test.describe('Social post actions', () => {
	test.setTimeout(600_000)

	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('dm from post card navigates to chat', async ({ page, baseUrl, apiKey, publishPost }) => {
		const entityHash = await fetchViewerEntityHash(baseUrl, apiKey)
		const { postId } = await publishPost(`dm-card ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await openPostMoreMenu(card)
		await card.locator(`[data-dm="${entityHash}"]`).click()
		await expect(page).toHaveURL(
			new RegExp(`/parts/shells:chat/hub/\\?contact=${entityHash}`),
			{ timeout: 20_000 },
		)
	})

	test('like and unlike toggle', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`like-toggle ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const likeBtn = card.locator('.like-btn')
		await likeBtn.click()
		await expect(likeBtn).toHaveAttribute('data-liked', '1', { timeout: 20_000 })
		await likeBtn.click()
		await expect(likeBtn).toHaveAttribute('data-liked', '0', { timeout: 20_000 })
	})

	test('submit repost appears in feed', async ({ page, publishPost }) => {
		const { postId: originalId } = await publishPost(`repost-src ${Date.now()}`)
		const card = await findPostCard(page, originalId)
		const repostKey = await card.locator('[data-repost]').getAttribute('data-repost')
		// 同一 postId 可能在 feed 出现多张卡片；面板须限定在当前卡片内
		const panel = card.locator(`[data-repost-for="${repostKey}"]`)
		await card.locator('[data-repost]').click()
		const comment = `repost-comment ${Date.now()}`
		await panel.locator('textarea').fill(comment)
		await Promise.all([
			page.waitForResponse(res =>
				res.url().includes('/api/parts/shells:social/profile/repost')
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			panel.locator('[data-submit-repost]').click(),
		])
		await expect(panel).toHaveClass(/hidden/)
		await page.locator('#feedRefreshBtn').click()
		await expect(page.locator('#feedList .repost-banner').first()).toBeVisible({ timeout: 30_000 })
	})

	test('translate appends translation block', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`translate-me ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await openPostMoreMenu(card)
		await card.locator('[data-translate]').click()
		await expect(card.locator('.translation-block')).toBeVisible({ timeout: 20_000 })
	})

	test('save modal confirm bookmarks post', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`modal-save ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('[data-save]').click()
		await expect(page.locator('#saveModal')).toBeVisible({ timeout: 20_000 })
		await page.locator('#saveConfirmBtn').click()
		await expect(page.locator('#saveModal')).toBeHidden({ timeout: 10_000 })
		await page.locator('.side-nav .nav-btn[data-view="saved"]').click()
		await expect(page.locator(`#savedView a[href*="${postId}"]`)).toBeVisible({ timeout: 20_000 })
	})

	test('like, delete, repost panel, save modal, and copy link', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`actions ${Date.now()}`)
		const card = await findPostCard(page, postId)

		const likeBtn = card.locator('.like-btn')
		await expect(likeBtn).toHaveAttribute('data-liked', '0')
		await likeBtn.click()
		await expect(card.locator('.like-btn')).toHaveAttribute('data-liked', '1', { timeout: 20_000 })

		await openPostMoreMenu(card)
		await card.locator('button[data-delete]').click()
		// 删除后 feed 可能仍短暂保留同 postId 的重复卡片，刷新 feed 再断言
		await page.locator('#feedRefreshBtn').click()
		await expect(page.locator(`#feedList [data-post-id="${postId}"]`)).toHaveCount(0, { timeout: 30_000 })

		const { postId: repostPostId } = await publishPost(`repost ${Date.now()}`)
		const repostCard = await findPostCard(page, repostPostId)
		const repostBtn = repostCard.locator('[data-repost]')
		const repostKey = await repostBtn.getAttribute('data-repost')
		// 同一 postId 可能在 feed 出现多张卡片；面板须限定在当前卡片内
		const repostPanel = repostCard.locator(`[data-repost-for="${repostKey}"]`)
		await repostBtn.click()
		await expect(repostPanel).not.toHaveClass(/hidden/)
		await repostBtn.click()
		await expect(repostPanel).toHaveClass(/hidden/)

		await repostCard.locator('button[data-save]').click()
		const saveModal = page.locator('#saveModal')
		await expect(saveModal).toBeVisible({ timeout: 20_000 })
		await saveModal.locator('#saveCancelBtn').click()
		await expect(saveModal).toBeHidden({ timeout: 10_000 })

		const copyBtn = repostCard.locator('[data-copy-link]')
		await openPostMoreMenu(repostCard)
		const labelBefore = (await copyBtn.textContent())?.trim() || ''
		await copyBtn.click()
		await expect(copyBtn.locator('[data-i18n="social.actions.copyLink"]')).not.toHaveText(labelBefore, { timeout: 10_000 })
	})
})

import { test, expect, openSocialHome, findPostCard, submitReplyViaPanel } from './fixtures.mjs'

test.describe('Social replies', () => {

	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('replies panel loads and accepts a reply', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`reply-target ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const repliesButton = card.locator('[data-replies]')
		const actionKey = await repliesButton.getAttribute('data-replies')
		await repliesButton.click()
		// 同一 postId 可能在 feed 出现多张卡片；面板须限定在当前卡片内
		const panel = card.locator(`[data-replies-for="${actionKey}"]`)
		await expect(panel).not.toHaveClass(/hidden/)
		const replyText = `reply-body ${Date.now()}`
		await panel.locator('textarea').fill(replyText)
		await submitReplyViaPanel(page, panel)
		await expect(card.locator('[data-replies] .action-count')).toHaveText('1', { timeout: 30_000 })
	})

	test('replies panel toggles closed', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`reply-toggle ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const repliesButton = card.locator('[data-replies]')
		const actionKey = await repliesButton.getAttribute('data-replies')
		// 同一 postId 可能在 feed 出现多张卡片；面板须限定在当前卡片内
		const panel = card.locator(`[data-replies-for="${actionKey}"]`)
		await repliesButton.click()
		await expect(panel).not.toHaveClass(/hidden/)
		await repliesButton.click()
		await expect(panel).toHaveClass(/hidden/)
	})
})

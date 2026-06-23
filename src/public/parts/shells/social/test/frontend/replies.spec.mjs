import { test, expect, openSocialHome, findPostCard } from './fixtures.mjs'

test.describe('Social replies', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('replies panel loads and accepts a reply', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`reply-target ${Date.now()}`)
		const card = await findPostCard(page, postId)
		const repliesBtn = card.locator('[data-replies]')
		const actionKey = await repliesBtn.getAttribute('data-replies')
		await repliesBtn.click()
		await expect(page.locator(`[data-replies-for="${actionKey}"]`)).not.toHaveClass(/hidden/)

		const panel = page.locator(`[data-replies-for="${actionKey}"]`)
		const replyText = `reply-body ${Date.now()}`
		await panel.locator('textarea').fill(replyText)
		await panel.locator('[data-submit-reply]').click()
		await expect(card.locator('[data-replies]')).toContainText(/\(1\)/, { timeout: 30_000 })
	})
})

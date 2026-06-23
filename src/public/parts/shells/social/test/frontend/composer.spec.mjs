import { test, expect, openSocialHome, expectPostInFeed, findPostCard } from './fixtures.mjs'

test.describe('Social composer', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('publishes a post via composer', async ({ publishPost }) => {
		const text = `playwright e2e ${Date.now()}`
		const { postJson } = await publishPost(text)
		expect(postJson.event?.type).toBe('post')
		expect(postJson.event?.content?.text).toBe(text)
	})

	test('does not submit empty composer', async ({ page }) => {
		await page.locator('#postText').fill('')
		let posted = false
		page.on('request', req => {
			if (req.url().includes('/profile/post') && req.method() === 'POST')
				posted = true
		})
		await page.locator('#postBtn').click()
		await page.waitForTimeout(500)
		expect(posted).toBe(false)
	})

	test('published post appears in feed', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`feed-visible ${Date.now()}`)
		await expectPostInFeed(page, postId)
	})

	test('quote preview opens from post card', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`quote-src ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
	})

	test('clears quote preview', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`clear-quote ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await card.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
		await page.locator('.clear-quote-btn').click()
		await expect(page.locator('#quotePreview')).toBeHidden()
	})

	test('publishes post with quote reference', async ({ page, publishPost }) => {
		const { postId: srcId } = await publishPost(`quote-parent ${Date.now()}`)
		const srcCard = await findPostCard(page, srcId)
		await srcCard.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
		const text = `quote-child ${Date.now()}`
		await page.locator('#postText').fill(text)
		await page.locator('#postBtn').click()
		await expect(page.locator('#postText')).toHaveValue('')
		await expect(page.locator('#feedList .quote-block').first()).toBeVisible({ timeout: 30_000 })
	})

	test('mention autocomplete suggests on @', async ({ page }) => {
		await page.locator('#postText').fill('@')
		await expect(page.locator('.mention-panel')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('.mention-option').first()).toBeVisible()
	})

	test('visibility selector is available', async ({ page }) => {
		const select = page.locator('#postVisibility')
		await expect(select).toBeVisible()
		await select.selectOption('followers')
		await expect(select).toHaveValue('followers')
		await select.selectOption('public')
	})

	test('publishes followers-only post with visibility label', async ({ page, publishPost }) => {
		await page.locator('#postVisibility').selectOption('followers')
		const { postId } = await publishPost(`followers-only ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await expect(card).toHaveAttribute('data-visibility', 'followers')
	})

	test('emoji picker opens from composer', async ({ page }) => {
		await page.locator('#emojiPickBtn').click()
		await expect(page.locator('#fount-shared-emoji-picker')).toBeVisible({ timeout: 20_000 })
	})
})

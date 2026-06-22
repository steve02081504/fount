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

	test('visibility selector is available', async ({ page }) => {
		const select = page.locator('#postVisibility')
		await expect(select).toBeVisible()
		await select.selectOption('followers')
		await expect(select).toHaveValue('followers')
		await select.selectOption('public')
	})
})

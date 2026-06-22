import {
	test,
	expect,
	openSocialHome,
	publishPostViaComposer,
	expectPostInFeed,
} from './fixtures.mjs'

test.describe('Social composer', () => {
	test.beforeEach(async ({ page, baseUrl }) => {
		await openSocialHome(page, baseUrl)
	})

	test('publishes a post via composer', async ({ page }) => {
		const text = `playwright e2e ${Date.now()}`
		const postJson = await publishPostViaComposer(page, text)
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

	test('published post appears in feed', async ({ page }) => {
		const text = `feed-visible ${Date.now()}`
		await publishPostViaComposer(page, text)
		await expectPostInFeed(page, text)
	})

	test('quote preview opens from post card', async ({ page }) => {
		const text = `quote-src ${Date.now()}`
		await publishPostViaComposer(page, text)
		const card = await expectPostInFeed(page, text)
		await card.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
		await expect(page.locator('#quotePreview .quote-preview-body')).toContainText(text)
	})

	test('visibility selector is available', async ({ page }) => {
		const select = page.locator('#postVisibility')
		await expect(select).toBeVisible()
		await select.selectOption('followers')
		await expect(select).toHaveValue('followers')
		await select.selectOption('public')
	})
})

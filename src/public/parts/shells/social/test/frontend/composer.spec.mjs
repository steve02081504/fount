import {
	test,
	expect,
	openSocialHome,
	expectPostInFeed,
	findPostCard,
	createTestGroup,
	TINY_PNG_BUFFER,
	waitForFeedLoad,
	postIdFromResponse,
	openPostMoreMenu,
} from './fixtures.mjs'

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
			if (req.url().includes('/posts') && req.method() === 'POST')
				posted = true
		})
		await page.locator('#postButton').click()
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
		await openPostMoreMenu(card)
		await card.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
	})

	test('clears quote preview', async ({ page, publishPost }) => {
		const { postId } = await publishPost(`clear-quote ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await openPostMoreMenu(card)
		await card.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
		await page.locator('.clear-quote-btn').click()
		await expect(page.locator('#quotePreview')).toBeHidden()
	})

	test('publishes post with quote reference', async ({ page, publishPost }) => {
		const { postId: srcId } = await publishPost(`quote-parent ${Date.now()}`)
		const srcCard = await findPostCard(page, srcId)
		await openPostMoreMenu(srcCard)
		await srcCard.locator('[data-quote]').click()
		await expect(page.locator('#quotePreview')).toBeVisible()
		const text = `quote-child ${Date.now()}`
		await page.locator('#postText').fill(text)
		const postResponsePromise = page.waitForResponse(res => {
			if (res.request().method() !== 'POST' || res.status() !== 200) return false
			return new URL(res.url()).pathname === '/api/parts/shells:social/posts'
		}, { timeout: 60_000 })
		await page.locator('#postButton').click()
		const [postResponse] = await Promise.all([postResponsePromise, waitForFeedLoad(page)])
		const childId = postIdFromResponse(await postResponse.json())
		await expect(page.locator('#postText')).toHaveValue('')
		await expectPostInFeed(page, childId)
	})

	test('mention autocomplete suggests on @', async ({ page }) => {
		await page.locator('#postText').fill('@')
		await expect(page.locator('.mention-panel')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('.mention-option').first()).toBeVisible()
	})

	test('mention autocomplete inserts selected entity', async ({ page }) => {
		await page.locator('#postText').fill('@')
		await expect(page.locator('.mention-panel .mention-option').first()).toBeVisible({ timeout: 20_000 })
		await page.locator('.mention-panel .mention-option').first().click()
		const value = await page.locator('#postText').inputValue()
		expect(value).toMatch(/^@\[entity:[\da-f]{128}\]$/iu)
	})

	test('visibility selector is available', async ({ page }) => {
		const select = page.locator('#postVisibility')
		await expect(select).toBeVisible()
		await select.selectOption('followers')
		await expect(select).toHaveValue('followers')
		await select.selectOption('unlisted')
		await expect(select).toHaveValue('unlisted')
		await select.selectOption('private')
		await expect(select).toHaveValue('private')
		await select.selectOption('public')
	})

	test('publishes followers-only post with visibility label', async ({ page, publishPost }) => {
		await page.locator('#postVisibility').selectOption('followers')
		const { postId } = await publishPost(`followers-only ${Date.now()}`)
		const card = await findPostCard(page, postId)
		await expect(card).toHaveAttribute('data-visibility', 'followers')
	})

	test('content warning toggle reveals and clears input', async ({ page }) => {
		const cwInput = page.locator('#postContentWarning')
		await expect(cwInput).toBeHidden()
		await page.locator('#composerCwToggle').click()
		await expect(cwInput).toBeVisible()
		await cwInput.fill('spoiler')
		await page.locator('#composerCwToggle').click()
		await expect(cwInput).toBeHidden()
		await page.locator('#composerCwToggle').click()
		await expect(cwInput).toHaveValue('')
	})

	test('advanced panel holds reply policy and opens on selected visibility', async ({ page }) => {
		const panel = page.locator('#composerAdvancedPanel')
		await expect(panel).toBeHidden()
		await page.locator('#composerAdvancedToggle').click()
		await expect(panel).toBeVisible()
		await expect(page.locator('#postReplyPolicy')).toBeVisible()
		await page.locator('#composerAdvancedToggle').click()
		await expect(panel).toBeHidden()
		// 选择「指定人员可见」时自动展开高级面板并显示 allow 输入
		await page.locator('#postVisibility').selectOption('selected')
		await expect(panel).toBeVisible()
		await expect(page.locator('[data-visibility-allow]')).toBeVisible()
		await page.locator('#postVisibility').selectOption('public')
	})

	test('emoji picker opens from composer', async ({ page }) => {
		await page.locator('#emojiPickButton').click()
		await expect(page.locator('#fount-shared-emoji-picker')).toBeVisible({ timeout: 20_000 })
	})

	test('emoji picker inserts token into composer', async ({ page }) => {
		await page.locator('#postText').fill('hello ')
		await page.locator('#emojiPickButton').click()
		const picker = page.locator('#fount-shared-emoji-picker')
		await expect(picker).toBeVisible({ timeout: 20_000 })
		// Recent tab may be empty; switch to first non-recent tab (unicode emoji group)
		const firstNonRecentTab = picker.locator('.hub-emoji-tab:not([data-tab="__recent__"])').first()
		await expect(firstNonRecentTab).toBeVisible({ timeout: 30_000 })
		await firstNonRecentTab.click()
		const gridButton = picker.locator('.hub-emoji-grid-button').first()
		await expect(gridButton).toBeVisible({ timeout: 30_000 })
		await gridButton.click()
		await expect(page.locator('#postText')).not.toHaveValue('hello ')
	})

	test('media upload shows preview and publishes image post', async ({ page, publishPost }) => {
		await page.locator('#mediaInput').setInputFiles({
			name: 'pw-test.png',
			mimeType: 'image/png',
			buffer: TINY_PNG_BUFFER,
		})
		await expect(page.locator('#mediaPreview:not(.hidden) .media-chip img'))
			.toBeVisible({ timeout: 30_000 })
		const text = `media-post ${Date.now()}`
		const { postId } = await publishPost(text)
		const card = await findPostCard(page, postId)
		await expect(card.locator('.post-media img.post-media-item')).toBeVisible({ timeout: 30_000 })
	})

	test('group ref picker links chat group in post', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await createTestGroup(baseUrl, apiKey)
		await openSocialHome(page, baseUrl)
		await page.locator('#composerAdvancedToggle').click()
		const groupSelect = page.locator('#linkGroupSelect')
		await expect(groupSelect).toBeVisible({ timeout: 30_000 })
		const optionValue = `${groupId}\t${channelId}`
		await expect(groupSelect.locator(`option[value="${optionValue}"]`)).toHaveCount(1, { timeout: 30_000 })
		await groupSelect.selectOption(optionValue)
		await groupSelect.dispatchEvent('change')
		await expect(page.locator('#groupRefPreview')).toBeVisible({ timeout: 20_000 })
		const text = `group-ref ${Date.now()}`
		await page.locator('#postText').fill(text)
		await page.locator('#postButton').click()
		await expect(page.locator('#postText')).toHaveValue('')
		await expect(page.locator('#feedList .group-ref-block').first()).toBeVisible({ timeout: 30_000 })
	})
})

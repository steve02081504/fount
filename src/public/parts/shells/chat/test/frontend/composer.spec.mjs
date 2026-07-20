import {
	test,
	expect,
	sendMessageViaComposer,
	expectMessageInChat,
	messageTextFromPostResponse,
	isChannelMessagePost,
} from './fixtures.mjs'

test.describe('Chat composer', () => {
	test('publishes a message via composer', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `composer e2e ${Date.now()}`
		const postJson = await sendMessageViaComposer(page, groupId, channelId, text)
		expect(postJson.event?.type).toBe('message')
		expect(messageTextFromPostResponse(postJson)).toBe(text)
	})

	test('does not submit empty composer', async ({ page, groupChannel: _ }) => {
		await page.locator('#message-input').fill('')
		const postPromise = page.waitForResponse(
			res => res.request().method() === 'POST'
				&& res.url().includes('/channels/')
				&& res.url().includes('/messages'),
			{ timeout: 2_000 },
		).catch(() => null)
		await page.locator('#send-button').click()
		expect(await postPromise).toBeNull()
		await expect(page.locator('#message-input')).toHaveValue('')
	})

	test('published message appears in channel', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `feed-visible ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await expectMessageInChat(page, text)
	})

	test('sends with Ctrl+Enter shortcut', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `ctrl-enter ${Date.now()}`
		const postPromise = page.waitForResponse(
			res => isChannelMessagePost(res, groupId, channelId),
			{ timeout: 20_000 },
		)
		await page.locator('#message-input').fill(text)
		await page.locator('#message-input').press('Control+Enter')
		const postJson = await (await postPromise).json()
		expect(postJson.event?.type).toBe('message')
		await expectMessageInChat(page, text)
	})

	test('emoji picker opens from composer', async ({ page, groupChannel: _ }) => {
		await page.locator('#emoji-button').click()
		await expect(page.locator('#emoji-picker')).toHaveClass(/show/)
		await expect(page.locator('#emoji-tabs .emoji-tab').first()).toBeVisible({ timeout: 30_000 })
	})

	test('sticker picker opens from composer', async ({ page, groupChannel: _ }) => {
		await page.locator('#sticker-button').click()
		await expect(page.locator('#sticker-picker')).toHaveClass(/show/)
		await expect(page.locator('#sticker-grid')).toBeVisible()
	})

	test('vote modal opens and cancels', async ({ page, groupChannel: _ }) => {
		await page.locator('#vote-button').click()
		await expect(page.locator('#vote-modal')).toBeVisible({ timeout: 10_000 })
		await page.locator('#vote-cancel-button').click()
		await expect(page.locator('#vote-modal')).toBeHidden({ timeout: 10_000 })
	})
})

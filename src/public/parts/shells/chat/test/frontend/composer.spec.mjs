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
		await page.locator('#hub-message-input').fill('')
		let posted = false
		page.on('request', req => {
			if (req.method() === 'POST' && req.url().includes('/channels/') && req.url().includes('/messages'))
				posted = true
		})
		await page.locator('#hub-send-button').click()
		await page.waitForTimeout(500)
		expect(posted).toBe(false)
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
		await page.locator('#hub-message-input').fill(text)
		await page.locator('#hub-message-input').press('Control+Enter')
		const postJson = await (await postPromise).json()
		expect(postJson.event?.type).toBe('message')
		await expectMessageInChat(page, text)
	})
})

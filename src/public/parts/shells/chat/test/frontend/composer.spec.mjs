import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	messageTextFromPostResponse,
} from './fixtures.mjs'

test.describe('Chat composer', () => {
	test('sends a message via composer', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `playwright e2e ${Date.now()}`
		const postJson = await sendMessageViaComposer(page, groupId, channelId, text)
		expect(postJson.event?.type).toBe('message')
		expect(messageTextFromPostResponse(postJson)).toBe(text)
	})

	test('does not submit empty composer', async ({ page, baseUrl, apiKey }) => {
		await openFreshGroupChannel(page, baseUrl, apiKey)
		await page.locator('#hub-message-input').fill('')
		let posted = false
		page.on('request', req => {
			if (req.url().includes('/messages') && req.method() === 'POST')
				posted = true
		})
		await page.locator('#hub-send-button').click()
		await page.waitForTimeout(500)
		expect(posted).toBe(false)
	})

	test('sent message appears in channel', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `channel-visible ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await expectMessageInChat(page, text)
	})

	test('Enter submits message when composer focused', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `enter-send ${Date.now()}`
		const encodedGroup = encodeURIComponent(groupId)
		const encodedChannel = encodeURIComponent(channelId)
		await page.locator('#hub-message-input').fill(text)
		const [postResponse] = await Promise.all([
			page.waitForResponse(res =>
				res.url().includes(`/groups/${encodedGroup}/channels/${encodedChannel}/messages`)
				&& res.request().method() === 'POST'
				&& res.status() === 200,
			),
			page.locator('#hub-message-input').press('Control+Enter'),
		])
		expect(messageTextFromPostResponse(await postResponse.json())).toBe(text)
		await expectMessageInChat(page, text)
	})
})

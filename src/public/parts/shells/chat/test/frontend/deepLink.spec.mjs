import {
	test,
	expect,
	openChatHub,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	waitForHubShell,
} from './fixtures.mjs'

test.describe('Chat deep links', () => {
	test('hash opens group channel directly', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `deeplink ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await waitForHubShell(page, baseUrl)
		await expect(page.locator('#hub-message-input')).toBeDisabled()
		const encodedGroup = encodeURIComponent(groupId)
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#group:${encodedGroup}:${channelId}`)
		await expect(page.locator('#hub-message-input')).toBeEnabled({ timeout: 180_000 })
		await expectMessageInChat(page, text)
	})

	test('friends hash opens friends view', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`)
		await expect(page).toHaveURL(/#friends/)
		await expect(page.locator('#hub-message-input')).toBeDisabled({ timeout: 180_000 })
	})
})

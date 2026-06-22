import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	waitForHubShell,
	openGroupChannel,
} from './fixtures.mjs'

test.describe('Chat deep links', () => {
	test('hash opens group channel directly', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `deeplink ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await waitForHubShell(page, baseUrl)
		await expect(page.locator('#hub-message-input')).toBeDisabled()
		await openGroupChannel(page, baseUrl, groupId, channelId)
		await expectMessageInChat(page, text)
	})

	test('friends hash opens friends view', async ({ page, baseUrl }) => {
		await waitForHubShell(page, baseUrl)
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'load' })
		await expect(page).toHaveURL(/#friends/)
		await expect(page.locator('#hub-message-input')).toBeDisabled({ timeout: 180_000 })
	})
})

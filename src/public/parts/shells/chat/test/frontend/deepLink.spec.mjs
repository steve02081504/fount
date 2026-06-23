import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	navigateGroupChannelHash,
	waitForHubCoreReady,
} from './fixtures.mjs'

test.describe('Chat deep links', () => {
	test('hash opens group channel directly', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `deeplink ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'domcontentloaded' })
		await waitForHubCoreReady(page)
		await expect(page.locator('#hub-message-input')).toBeDisabled({ timeout: 60_000 })
		await navigateGroupChannelHash(page, groupId, channelId)
		await expectMessageInChat(page, text)
	})

	test('friends hash opens friends view', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'domcontentloaded' })
		await waitForHubCoreReady(page)
		await expect(page).toHaveURL(/#friends/)
		await expect(page.locator('#hub-server-bar')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('#hub-message-input')).toBeDisabled({ timeout: 60_000 })
	})
})

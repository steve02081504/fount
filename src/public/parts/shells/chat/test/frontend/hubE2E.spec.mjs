import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	messageTextFromPostResponse,
	navigateGroupChannelHash,
} from './fixtures.mjs'

test.describe('Chat hub integration', () => {
	test.describe.configure({ timeout: 600_000 })

	test('composer, navigation, profile, and smoke checks', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)

		const text = `playwright e2e ${Date.now()}`
		const postJson = await sendMessageViaComposer(page, groupId, channelId, text)
		expect(postJson.event?.type).toBe('message')
		expect(messageTextFromPostResponse(postJson)).toBe(text)

		await page.locator('.server-item[data-mode="friends"]').click()
		await expect(page.locator('#message-input')).toBeDisabled({ timeout: 30_000 })
		await navigateGroupChannelHash(page, groupId, channelId)

		await page.locator('#toggle-members-button').click()
		await expect(page.locator('#member-bar')).toHaveClass(/member-bar--open/)

		const searchText = `search-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, searchText)
		await expectMessageInChat(page, searchText)

		await page.goto(`${baseUrl}/parts/shells:chat/profile`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#profile-edit-button')).toBeVisible({ timeout: 30_000 })
	})
})

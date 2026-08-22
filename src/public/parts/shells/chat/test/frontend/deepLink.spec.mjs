import { waitForHubReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
	expectMessageInChat,
	navigateGroupChannelHash,
} from './fixtures.mjs'

test.describe('Chat deep links', () => {
	test('hash opens group channel directly', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		const text = `deeplink ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'domcontentloaded' })
		await waitForHubReady(page)
		await expect(page.locator('#message-input')).toBeDisabled({ timeout: 60_000 })
		await navigateGroupChannelHash(page, groupId, channelId)
		await expectMessageInChat(page, text)
	})

	test('friends hash opens friends view', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/#friends`, { waitUntil: 'domcontentloaded' })
		await waitForHubReady(page)
		await expect(page).toHaveURL(/#friends/)
		await expect(page.locator('#server-bar')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('#message-input')).toBeDisabled({ timeout: 60_000 })
	})

	test('char deep link opens friend chat and enables composer', async ({ page, baseUrl }) => {
		// 新用户通过 `?char=` 直达角色好友私聊：应建群、加载消息并启用 composer，
		// 而不是永远停留在 loading spinner（回归：selectChannel 在 friends 模式空返回）。
		await page.goto(`${baseUrl}/parts/shells:chat/hub/?char=on_message_yes`, {
			waitUntil: 'domcontentloaded',
		})
		await waitForHubReady(page)
		await expect(page).toHaveURL(/#group:/, { timeout: 60_000 })
		await expect(page.locator('#message-input')).toBeEnabled({ timeout: 60_000 })
		// 消息区不再停留在 loading
		await expect(page.locator('#messages .loading')).toHaveCount(0, { timeout: 60_000 })
	})
})

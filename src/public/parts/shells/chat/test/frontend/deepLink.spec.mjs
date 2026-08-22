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

	test('char sidebar shows a non-blank viewer name while async profile loads', async ({ page, baseUrl }) => {
		// 回归：角色私聊侧栏的 viewer 成员名依赖异步 `store.viewer.viewerDisplayName`，
		// profile 拉取未完成时渲染为纯空白。需回退到当前群 viewer 成员 displayName。
		await page.goto(`${baseUrl}/parts/shells:chat/hub/?char=on_message_yes`, {
			waitUntil: 'domcontentloaded',
		})
		await waitForHubReady(page)
		const viewerItem = page.locator('#member-list .member-item:not([data-char])')
		await expect(viewerItem).toHaveCount(1, { timeout: 60_000 })
		await expect(viewerItem.locator('.member-name')).toHaveText(/\S/, { timeout: 60_000 })
	})
})

import { request as playwrightRequest } from '@playwright/test'

import {
	test,
	expect,
	createTestChannel,
	navigateGroupChannelHash,
	expectMessageInChat,
} from './fixtures.mjs'

/**
 * 通过 HTTP API 向频道发消息（模拟其他端/成员写入，不经当前页面 composer）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} text 消息正文
 * @returns {Promise<void>} 无返回值
 */
async function postMessageViaApi(baseUrl, apiKey, groupId, channelId, text) {
	const req = await playwrightRequest.newContext()
	try {
		const res = await req.post(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/messages?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { content: { type: 'text', content: text } } },
		)
		if (!res.ok()) throw new Error(`postMessage failed: ${res.status()}`)
	}
	finally {
		await req.dispose()
	}
}

/**
 * 等待指定频道 read-marker PUT 落盘（loadMessages 打开频道后即标已读）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @param {string} channelId 目标频道 ID
 * @param {() => Promise<void>} trigger 触发导航的动作
 * @returns {Promise<void>} 无返回值
 */
async function withReadMarkerSettled(page, channelId, trigger) {
	const putPromise = page.waitForResponse(
		res => res.request().method() === 'PUT'
			&& new URL(res.url()).pathname.endsWith(`/channels/${encodeURIComponent(channelId)}/read-marker`)
			&& res.status() === 200,
		{ timeout: 60_000 },
	)
	await trigger()
	await putPromise
}

test.describe('Unread badge & divider', () => {
	test.setTimeout(600_000)

	test('other-channel message shows group badge; divider on revisit; badge clears after read', async ({ page, baseUrl, apiKey, groupChannel }) => {
		const { groupId, channelId: defaultChannelId } = groupChannel
		const { channelId: otherChannelId } = await createTestChannel(baseUrl, apiKey, groupId)

		// 第一条消息 + 首次访问：建立 read-marker 水位（首条即未读时分割线不渲染，属预期）
		const first = `unread-first ${Date.now()}`
		await postMessageViaApi(baseUrl, apiKey, groupId, otherChannelId, first)
		await withReadMarkerSettled(page, otherChannelId, () => navigateGroupChannelHash(page, groupId, otherChannelId))
		await expectMessageInChat(page, first)

		// 回默认频道后另一频道来新消息 → 服务端未读模型 → 群图标 badge
		await navigateGroupChannelHash(page, groupId, defaultChannelId)
		const second = `unread-second ${Date.now()}`
		await postMessageViaApi(baseUrl, apiKey, groupId, otherChannelId, second)

		const groupBadge = page.locator(`#server-list .server-item[data-group-id="${groupId}"] .unread-badge`)
		// WS bump 或全量刷新皆可让 badge 出现；reload 走 loadGroups 的服务端 unreadCount，行为确定
		await page.reload({ waitUntil: 'domcontentloaded' })
		// 等默认频道 boot 完成后再切未读频道，避免与 selectGroup 的 await 竞态互相踩 hash
		await expect(page.locator('#message-input')).toBeEnabled({ timeout: 60_000 })
		await expect(page.locator(`.channel-item.active[data-channel-id="${defaultChannelId}"]`)).toBeVisible({ timeout: 60_000 })
		await expect(groupBadge).toBeVisible({ timeout: 60_000 })
		await expect(groupBadge).toHaveText('1')

		// 切到未读频道：最早未读分割线渲染在第二条消息之前，已读后 badge 清零
		await withReadMarkerSettled(page, otherChannelId, () => navigateGroupChannelHash(page, groupId, otherChannelId))
		await expect(page.locator(`.channel-item.active[data-channel-id="${otherChannelId}"]`)).toBeVisible({ timeout: 60_000 })
		await expectMessageInChat(page, second)
		await expect(page.locator('#messages .unread-divider')).toBeVisible({ timeout: 60_000 })
		await expect(groupBadge).toHaveCount(0, { timeout: 60_000 })
	})
})

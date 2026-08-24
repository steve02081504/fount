/**
 * DM 视图下频道列表空白区右键菜单：新建频道（无弹窗；后端异步清理 greeting-only 占位频道）与新建分类。
 */
import { ms } from 'fount/scripts/ms.mjs'
import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'
import { waitForHubReady } from 'fount/scripts/test/playwright/ready.mjs'

import {
	createFriendChatGroup,
	expect,
	expectMessageInChat,
	navigateGroupChannelHash,
	parseGroupHashFromUrl,
	test,
	waitForHub,
} from './fixtures.mjs'

const HUB_INIT_TIMEOUT = ms('3m')

/**
 * 在频道列表空白区派发带真实坐标的右键事件（Playwright dispatchEvent 只建泛型 Event，
 * 不携带 clientX/clientY，菜单会以 NaN 定位而落到视口外）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>} 无返回值
 */
async function openChannelListContextMenu(page) {
	await page.locator('.channel-list-virtual').evaluate(el => {
		el.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			clientX: 100,
			clientY: 100,
		}))
	})
}

/**
 * 通过 API 创建 DM 群并在默认频道注入一条 world-greeting（仅含问候语）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @returns {Promise<{ groupId: string, defaultChannelId: string }>} DM 群信息
 */
async function createDmWithGreeting(baseUrl, apiKey) {
	const { groupId, defaultChannelId } = await createFriendChatGroup(baseUrl, apiKey, 'on_message_yes')
	await withApiRequest(async req => {
		const key = encodeURIComponent(apiKey)
		const groupPath = encodeURIComponent(groupId)
		const addRes = await req.post(
			`${baseUrl}/api/parts/shells:chat/groups/${groupPath}/char?fount-apikey=${key}`,
			{ data: { charname: 'on_message_yes', deferGreeting: false } },
		)
		if (!addRes.ok()) throw new Error(`addChar failed: ${addRes.status()} ${await addRes.text()}`)
		const bindRes = await req.put(
			`${baseUrl}/api/parts/shells:chat/groups/${groupPath}/world?fount-apikey=${key}`,
			{ data: { worldname: 'write_path_hooks', channelId: defaultChannelId } },
		)
		if (!bindRes.ok()) throw new Error(`bindWorld failed: ${bindRes.status()} ${await bindRes.text()}`)
	})
	return { groupId, defaultChannelId }
}

test.describe('DM channel list context menu', () => {
	test.describe.configure({ timeout: ms('3m') })

	test('DM list right-click opens menu and quick-creates a channel without a dialog', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/?char=on_message_yes`, {
			waitUntil: 'domcontentloaded',
			timeout: HUB_INIT_TIMEOUT,
		})
		await waitForHubReady(page)
		await expect(page).toHaveURL(/#group:/, { timeout: 60_000 })
		await expect(page.locator('#message-input')).toBeEnabled({ timeout: 60_000 })

		const { channelId: initialChannelId } = parseGroupHashFromUrl(page.url()) || {}
		expect(initialChannelId).toBeTruthy()
		await expect(page.locator('.channel-list-virtual')).toBeVisible({ timeout: 30_000 })

		await openChannelListContextMenu(page)
		await expect(page.locator('[data-action="create-channel"]')).toBeVisible()
		await expect(page.locator('[data-action="create-category"]')).toBeVisible()

		await page.locator('[data-action="create-channel"]').click()

		// DM 新建频道不弹对话框
		await expect(page.locator('#new-channel-name')).toHaveCount(0)
		// 原频道仍保留，新增一个频道 → 共 2 个
		await expect(page.locator('#private-channel-list-host .channel-item')).toHaveCount(2, { timeout: 30_000 })
		await expect(page.locator(`#private-channel-list-host .channel-item[data-channel-id="${initialChannelId}"]`))
			.toBeVisible()

		const after = parseGroupHashFromUrl(page.url())
		expect(after?.channelId).toBeTruthy()
		expect(after?.channelId).not.toBe(initialChannelId)
	})

	test('DM quick-create: backend async-removes greeting-only default channel', async ({ page, baseUrl, apiKey }) => {
		const { groupId, defaultChannelId } = await createDmWithGreeting(baseUrl, apiKey)

		await waitForHub(page, baseUrl, { friendsMode: false })
		await expect(page).toHaveURL(/#friends/, { timeout: 60_000 })
		await navigateGroupChannelHash(page, groupId, defaultChannelId)

		// 默认频道仅含一条问候语
		await expectMessageInChat(page, 'world-greeting')
		await expect(page.locator('.channel-list-virtual')).toBeVisible({ timeout: 30_000 })

		await openChannelListContextMenu(page)
		await expect(page.locator('[data-action="create-channel"]')).toBeVisible()
		await page.locator('[data-action="create-channel"]').click()

		await expect(page.locator('#new-channel-name')).toHaveCount(0)
		// 后端异步把仅含问候语的默认占位频道删除，最终只剩新建的未命名频道
		await expect(page.locator(`#private-channel-list-host .channel-item[data-channel-id="${defaultChannelId}"]`))
			.toHaveCount(0, { timeout: 60_000 })
		await expect(page.locator('#private-channel-list-host .channel-item')).toHaveCount(1)

		const after = parseGroupHashFromUrl(page.url())
		expect(after?.channelId).toBeTruthy()
		expect(after?.channelId).not.toBe(defaultChannelId)
	})
})

/**
 * DM 视图下频道列表空白区右键菜单：新建频道（无弹窗）与新建分类。
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
 * 通过 API 创建 DM 群并在初始频道注入一条 world-greeting（仅含问候语）。
 * DM 群无默认频道，初始频道由 fixture 解析为最上侧第一个可打开频道。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @returns {Promise<{ groupId: string, greetingChannelId: string }>} DM 群信息
 */
async function createDmWithGreeting(baseUrl, apiKey) {
	const { groupId, channelId } = await createFriendChatGroup(baseUrl, apiKey, 'on_message_yes', { forceNew: true })
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
			{ data: { worldname: 'write_path_hooks', channelId } },
		)
		if (!bindRes.ok()) throw new Error(`bindWorld failed: ${bindRes.status()} ${await bindRes.text()}`)
	})
	return { groupId, greetingChannelId: channelId }
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
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false, { timeout: 60_000 })

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

		// 后端经 WS 推送 channel_create 会先于 POST 响应把新频道渲染进侧栏（count 先变为 2），
		// quickCreate 的导航（落 hash）紧随 POST 响应之后；故此处等 URL 落到新频道而非 count 变化。
		await page.waitForFunction(
			initialChannelId => {
				const hash = location.hash.slice(1)
				if (!hash.startsWith('group:')) return false
				const rest = hash.slice('group:'.length)
				const separatorIndex = rest.indexOf(':')
				if (separatorIndex < 0) return false
				const channelId = rest.slice(separatorIndex + 1)
				return channelId && channelId !== initialChannelId
			},
			initialChannelId,
			{ timeout: 30_000 },
		)
		const after = parseGroupHashFromUrl(page.url())
		expect(after?.channelId).toBeTruthy()
		expect(after?.channelId).not.toBe(initialChannelId)
	})

	test('DM quick-create: keeps the greeting channel and switches to the new one', async ({ page, baseUrl, apiKey }) => {
		const { groupId, greetingChannelId } = await createDmWithGreeting(baseUrl, apiKey)

		await waitForHub(page, baseUrl, { friendsMode: false })
		await expect(page).toHaveURL(/#friends/, { timeout: 60_000 })
		await navigateGroupChannelHash(page, groupId, greetingChannelId)

		// 问候频道仅含一条问候语
		await expectMessageInChat(page, 'world-greeting')
		await expect(page.locator('.channel-list-virtual')).toBeVisible({ timeout: 30_000 })

		await openChannelListContextMenu(page)
		await expect(page.locator('[data-action="create-channel"]')).toBeVisible()
		await page.locator('[data-action="create-channel"]').click()

		await expect(page.locator('#new-channel-name')).toHaveCount(0)
		// 只含问候语的频道不再被自动清理：与新建频道并存（共 2 个）
		await expect(page.locator(`#private-channel-list-host .channel-item[data-channel-id="${greetingChannelId}"]`))
			.toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#private-channel-list-host .channel-item')).toHaveCount(2)

		// 侧栏计数先于 POST 响应刷新，导航落 hash 紧随其后；等待 hash 落到新频道。
		await expect.poll(() => parseGroupHashFromUrl(page.url())?.channelId, { timeout: 30_000 })
			.not.toBe(greetingChannelId)
	})
})

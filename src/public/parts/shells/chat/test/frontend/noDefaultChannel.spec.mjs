/**
 * 无默认频道：删光频道后主区空态（含新建频道 CTA）；右键默认频道可取消默认。
 */
import { createChatTestGroup, withApiRequest } from 'fount/scripts/test/playwright/api.mjs'

import {
	createTestChannel,
	expect,
	parseGroupHashFromUrl,
	test,
	waitForHub,
} from './fixtures.mjs'

const TEST_TIMEOUT = 180_000

/**
 * 通过 API 删除频道。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
async function deleteChannelViaApi(baseUrl, apiKey, groupId, channelId) {
	await withApiRequest(async req => {
		const res = await req.delete(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}?fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		if (!res.ok()) throw new Error(`deleteChannel failed: ${res.status()} ${await res.text()}`)
	})
}

test.describe('Group with no default channel', () => {
	test.describe.configure({ timeout: TEST_TIMEOUT })

	test('deleting the only default channel leaves an empty-state main pane with a create CTA', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await createChatTestGroup(baseUrl, apiKey)
		expect(channelId).toBeTruthy()
		await deleteChannelViaApi(baseUrl, apiKey, groupId, channelId)

		await waitForHub(page, baseUrl, { friendsMode: false })
		await page.evaluate(gid => { location.hash = `group:${encodeURIComponent(gid)}` }, groupId)

		await expect(page.locator('#messages #empty-create-channel')).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', true)

		// 普通群 CTA 弹出新建频道对话框，创建后主区进入新频道。
		await page.locator('#empty-create-channel').click()
		await expect(page.locator('#new-channel-name')).toBeVisible()
		await page.locator('#new-channel-name').fill('first')
		await page.locator('#new-channel-create').click()
		await expect(page.locator('#channel-list .channel-item')).toHaveCount(1, { timeout: 60_000 })
		const after = parseGroupHashFromUrl(page.url())
		expect(after?.groupId).toBe(groupId)
		expect(after?.channelId).toBeTruthy()
	})

	test('right-click default channel shows unset-default and clears it', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId: defaultChannelId } = await createChatTestGroup(baseUrl, apiKey)
		await createTestChannel(baseUrl, apiKey, groupId)
		await waitForHub(page, baseUrl, { friendsMode: false })
		await page.evaluate(
			({ gid, cid }) => { location.hash = `group:${encodeURIComponent(gid)}:${encodeURIComponent(cid)}` },
			{ gid: groupId, cid: defaultChannelId },
		)

		const defaultItem = page.locator(`.channel-item[data-channel-id="${defaultChannelId}"]`)
		await expect(defaultItem).toBeVisible({ timeout: 60_000 })
		await expect(page.locator('#message-input')).toHaveJSProperty('disabled', false, { timeout: 60_000 })

		await defaultItem.click({ button: 'right' })
		await expect(page.locator('.channel-menu-unset-default')).toBeVisible()
		await expect(page.locator('.channel-menu-set-default')).toHaveCount(0)
		await page.locator('.channel-menu-unset-default').click()

		// 取消默认后，同一频道右键改为提供「设为默认频道」；等待状态刷新（重新右键会关闭旧菜单）。
		await expect.poll(async () => {
			await defaultItem.click({ button: 'right' })
			await page.waitForTimeout(150)
			return page.locator('.channel-menu-set-default').isVisible().catch(() => false)
		}, { timeout: 30_000, intervals: [500, 1000] }).toBe(true)
		await expect(page.locator('.channel-menu-unset-default')).toHaveCount(0)
	})
})

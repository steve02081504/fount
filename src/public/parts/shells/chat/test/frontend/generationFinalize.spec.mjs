import { ms } from 'fount/scripts/ms.mjs'
import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'

import {
	test,
	expect,
} from './fixtures.mjs'

/**
 * 通过 API 向测试群添加角色。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @param {string} charname 角色名
 * @returns {Promise<void>} 无返回值
 */
async function addCharToGroup(baseUrl, apiKey, groupId, charname) {
	await withApiRequest(async request => {
		const response = await request.post(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/char?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { charname } },
		)
		if (!response.ok()) throw new Error(`addChar failed: ${response.status()}`)
	})
}

/**
 * 通过 API 触发频道内角色回复。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {Promise<void>} 无返回值
 */
async function triggerCharReply(baseUrl, apiKey, groupId, channelId, charname) {
	await withApiRequest(async request => {
		const response = await request.post(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/trigger-reply?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { charname } },
		)
		if (!response.ok()) throw new Error(`trigger-reply failed: ${response.status()}`)
	})
}

/**
 * 通过 API 向频道发送用户消息。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} text 消息正文
 * @returns {Promise<void>} 无返回值
 */
async function sendApiMessage(baseUrl, apiKey, groupId, channelId, text) {
	await withApiRequest(async request => {
		const response = await request.post(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/messages?fount-apikey=${encodeURIComponent(apiKey)}`,
			// isAutoTrigger 抑制入站触发管线，确保只由下方显式 trigger-reply 产生一次回复
			{ data: { content: { content: text, locale: 'zh-CN', extension: { chat: { isAutoTrigger: true } } } } },
		)
		if (!response.ok()) throw new Error(`sendApiMessage failed: ${response.status()}`)
	})
}

/**
 * 通过 /api/getlocaledata 确定性设置操作者首选语言（user.locales 优先于消息 locale）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} locale 首选 locale
 * @returns {Promise<void>} 无返回值
 */
async function setUserLocale(baseUrl, apiKey, locale) {
	await withApiRequest(async request => {
		const response = await request.get(
			`${baseUrl}/api/getlocaledata?preferred=${encodeURIComponent(locale)}&fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		if (!response.ok()) throw new Error(`setUserLocale failed: ${response.status()}`)
	})
}

test.describe('Chat generation finalize', () => {
	test.setTimeout(600_000)

	test('non-streaming char reply clears generating state and renders a single row without refresh', async ({
		page,
		groupChannel,
		apiKey,
		baseUrl,
	}) => {
		const { groupId, channelId } = groupChannel
		await addCharToGroup(baseUrl, apiKey, groupId, 'noai_locale_reporter')
		await setUserLocale(baseUrl, apiKey, 'zh-CN')
		await sendApiMessage(baseUrl, apiKey, groupId, channelId, '请说点什么')
		await triggerCharReply(baseUrl, apiKey, groupId, channelId, 'noai_locale_reporter')

		// 不刷新页面：终稿必须在 WS 推送后自行落地
		const replyRows = page.locator('#messages .message:not([data-pending="1"])').filter({ hasText: '【中文回复】' })
		await expect(replyRows.first()).toBeVisible({ timeout: ms('3m') })
		await expect(replyRows).toHaveCount(1, { timeout: ms('30s') })
		await expect(replyRows.first()).toHaveAttribute('data-char-id', /./)

		// 「生成中」占位必须被终稿替换：不再有 data-streaming 行或 typing 指示
		await expect(page.locator('#messages .message[data-streaming]')).toHaveCount(0, { timeout: ms('30s') })
		await expect(page.locator('#messages .streaming-typing')).toHaveCount(0)

		// 短暂稳定期后仍只有一行（防并发刷新/终稿 patch 竞态造成的重复 DOM 行）
		await page.waitForTimeout(ms('3s'))
		await expect(replyRows).toHaveCount(1)
		await expect(page.locator('#messages .message[data-streaming]')).toHaveCount(0)
	})
})

import { ms } from 'fount/scripts/ms.mjs'
import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'

import {
	test,
	expect,
	openFreshGroupChannel,
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
 * 通过 API 发送用户消息（isAutoTrigger 抑制入站触发管线）。
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
			{ data: { content: { content: text, locale: 'zh-CN', extension: { chat: { isAutoTrigger: true } } } } },
		)
		if (!response.ok()) throw new Error(`sendApiMessage failed: ${response.status()}`)
	})
}

/**
 * 通过 /api/getlocaledata 确定性设置操作者首选语言。
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

/**
 * 读取群 state（含成员列表）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} `/state` 响应
 */
async function getGroupState(baseUrl, apiKey, groupId) {
	return withApiRequest(async request => {
		const response = await request.get(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/state?fount-apikey=${encodeURIComponent(apiKey)}`,
		)
		if (!response.ok()) throw new Error(`group state failed: ${response.status()}`)
		return response.json()
	})
}

/**
 * 更新实体资料（局部化切片，走真实资料保存路径）。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} entityHash 128 位 entityHash
 * @param {object} updates 更新内容
 * @returns {Promise<object>} 更新响应
 */
async function updateEntityProfile(baseUrl, apiKey, entityHash, updates) {
	return withApiRequest(async request => {
		const response = await request.put(
			`${baseUrl}/api/parts/shells:chat/entities/${encodeURIComponent(entityHash)}?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: updates },
		)
		if (!response.ok()) throw new Error(`updateEntityProfile failed: ${response.status()}`)
		return response.json()
	})
}

test.describe('Chat profile popup refresh', () => {
	test.describe.configure({ timeout: 600_000 })

	test('profile popup fresh fetch propagates new name/avatar to message and member lists without reload', async ({
		page,
		baseUrl,
		apiKey,
	}) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await addCharToGroup(baseUrl, apiKey, groupId, 'on_message_yes')
		await sendApiMessage(baseUrl, apiKey, groupId, channelId, `profile-popup-seed ${Date.now()}`)
		await triggerCharReply(baseUrl, apiKey, groupId, channelId, 'on_message_yes')

		// 角色的回复消息进入消息列表
		const replyRow = page.locator('#messages .message:not([data-pending="1"])').filter({ hasText: 'on_message_yes reply' })
		await expect(replyRow.first()).toBeVisible({ timeout: ms('1m') })
		await expect(replyRow.first()).toHaveAttribute('data-char-id', 'on_message_yes')
		const messageAvatar = replyRow.first().locator('.chat-image [data-avatar-for]')
		await expect(messageAvatar).toBeVisible({ timeout: ms('30s') })
		const messageAuthor = replyRow.first().locator('.message-author')

		// 解析角色 entityHash 并定位其成员行（成员侧栏可能折叠，用计数/属性断言而非可见性）
		const state = await getGroupState(baseUrl, apiKey, groupId)
		const charRow = (state.meta?.members || []).find(member => member.charname === 'on_message_yes')
		expect(charRow?.entityHash).toMatch(/^[\da-f]{128}$/i)
		const entityHash = charRow.entityHash
		const charMember = page.locator(`#member-list .member-item[data-entity-hash="${entityHash}"]`)
		await expect(charMember).toHaveCount(1, { timeout: ms('30s') })
		const memberAvatar = charMember.locator('.member-avatar[data-avatar-for]')
		await expect(memberAvatar).toHaveCount(1)

		// 记录旧展示态（头像图 URL + 作者名）
		await expect(messageAvatar.locator('img')).toBeVisible()
		const oldMessageAvatarSrc = await messageAvatar.locator('img').getAttribute('src')
		await expect(memberAvatar.locator('img')).toHaveCount(1, { timeout: ms('30s') })
		const oldMemberAvatarSrc = await memberAvatar.locator('img').getAttribute('src')
		expect(oldMessageAvatarSrc).toBeTruthy()
		expect(oldMemberAvatarSrc).toBeTruthy()
		const oldAuthorLabel = (await messageAuthor.textContent())?.trim()

		// 通过资料 API 更改该实体的展示名与头像（本机单节点不触发 profile_update 广播）
		await setUserLocale(baseUrl, apiKey, 'zh-CN')
		const newName = `Renamed Char ${Date.now()}`
		const { Buffer } = await import('node:buffer')
		const newAvatar = 'data:image/svg+xml;base64,'
			+ Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#d00"/></svg>').toString('base64')
		await updateEntityProfile(baseUrl, apiKey, entityHash, {
			localized: { 'zh-CN': { name: newName, avatar: newAvatar } },
		})

		// 复现：列表仍展示旧资料（无 WS 广播自动刷新）
		await expect(messageAvatar.locator('img')).toHaveAttribute('src', oldMessageAvatarSrc)
		await expect(messageAuthor).toHaveText(oldAuthorLabel)

		// 点击消息头像打开资料弹层：forceRemote 拉取最新资料
		await messageAvatar.click()
		const popup = page.locator('#profile-popup-layer')
		await expect(popup).toBeVisible({ timeout: ms('30s') })
		await expect(popup.locator('[data-entity-profile-name]')).toHaveText(newName, { timeout: ms('30s') })

		// 不刷新页面：消息头像/作者名与成员列表头像应更新为新资料
		await expect(messageAuthor).toHaveText(newName, { timeout: ms('30s') })
		await expect(messageAvatar.locator('img')).toHaveAttribute('src', newAvatar, { timeout: ms('30s') })
		await expect(memberAvatar.locator('img')).toHaveAttribute('src', newAvatar, { timeout: ms('30s') })
	})
})

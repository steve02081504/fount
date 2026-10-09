import { ms } from 'fount/scripts/ms.mjs'
import { withApiRequest } from 'fount/scripts/test/playwright/api.mjs'

import { formatChatDmShareUrl } from '../../public/shared/runUri.mjs'

import {
	test,
	expect,
	openFreshGroupChannel,
} from './fixtures.mjs'

test('DM friend labels hydrate current profiles without inheriting the open group persona', async ({ modulePage }) => {
	const { page } = modulePage
	const peer = '3'.repeat(64) + '1'.repeat(64)
	const aliasedPeer = '3'.repeat(64) + '2'.repeat(64)
	const requests = []
	await page.route('**/api/parts/shells:chat/entities/*', async route => {
		requests.push(route.request().url())
		await route.fulfill({ json: { profile: { name: 'Current peer name', status: 'offline' } } })
	})
	await page.route('**/api/parts/shells:chat/aliases*', route => route.fulfill({
		json: { entities: { [aliasedPeer]: 'My alias' }, groups: {} },
	}))
	await modulePage.run(async ({ peer, aliasedPeer }) => {
		const { loadAliases } = await import('/parts/shells:chat/shared/aliases.mjs')
		const { buildFriendRows } = await import('/parts/shells:chat/shared/friendRows.mjs')
		const { renderFriendsColumn } = await import('/parts/shells:chat/hub/friendsList.mjs')
		const { store } = await import('/parts/shells:chat/hub/core/state.mjs')
		await loadAliases()
		store.context.currentGroupId = 'unrelated-open-group'
		const header = document.createElement('div')
		header.id = 'group-name-display'
		const host = document.createElement('div')
		host.id = 'channel-list'
		document.body.append(header, host)
		await renderFriendsColumn(buildFriendRows([peer, aliasedPeer].map((entityHash, index) => ({
			groupId: `dm-${index}`,
			friendBinding: { entityHash, displayName: 'Stale binding name' },
		}))))
	}, { peer, aliasedPeer })
	await expect(page.locator(`[data-entity-hash="${peer}"] .char-list-name`)).toHaveText('Current peer name')
	await expect(page.locator(`[data-entity-hash="${aliasedPeer}"] .char-list-name`)).toHaveText('My alias')
	expect(requests).toHaveLength(2)
	expect(requests.every(url => !new URL(url).searchParams.has('groupId'))).toBe(true)
})

test('sidebar profile fits its rail and long bio folds to its first lines with keyboard expand/collapse', async ({ modulePage }) => {
	const { page } = modulePage
	await modulePage.run(async () => {
		const { createEntityProfileCardElement, paintEntityProfileBio } = await import('/parts/shells:chat/shared/entityProfileCard.mjs')
		const rail = document.createElement('aside')
		rail.id = 'profile-test-rail'
		rail.style.width = '240px'
		const card = await createEntityProfileCardElement('sidebar')
		rail.append(card)
		document.body.append(rail)
		await paintEntityProfileBio(card.querySelector('[data-entity-profile-bio]'), Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${'long biography '.repeat(10)}`).join('\n\n'))
		await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise(resolve => link.addEventListener('load', resolve, { once: true }))))
	})
	const rail = page.locator('#profile-test-rail')
	const bio = rail.locator('[data-entity-profile-bio]')
	const toggle = rail.locator('[data-profile-popup-bio-toggle]')
	/**
	 * 读取测试卡几何。
	 * @returns {Promise<object>} 宽度 / 高度 / 滚动高度
	 */
	const geometry = () => rail.evaluate(el => {
		const body = el.querySelector('[data-entity-profile-bio]')
		const card = el.querySelector('.profile-popup')
		return {
			width: el.clientWidth,
			scrollWidth: el.scrollWidth,
			cardRight: card.getBoundingClientRect().right,
			railRight: el.getBoundingClientRect().right,
			bioHeight: body.clientHeight,
			bioScrollHeight: body.scrollHeight,
		}
	})

	// 折叠态：露头几行（正文被裁切，仍可见），按钮为「展开」
	await expect(bio).toBeVisible()
	await expect(toggle).toHaveAttribute('data-i18n', 'social.feed.showMore')
	const folded = await geometry()
	expect(folded.scrollWidth).toBeLessThanOrEqual(folded.width)
	expect(folded.cardRight).toBeLessThanOrEqual(folded.railRight)
	expect(folded.bioScrollHeight).toBeGreaterThan(folded.bioHeight + 1)

	await toggle.focus()
	await toggle.press('Enter')
	await expect(toggle).toHaveAttribute('data-i18n', 'social.feed.showLess')
	const expanded = await geometry()
	expect(expanded.bioHeight).toBeGreaterThan(folded.bioHeight * 2)
	expect(expanded.bioScrollHeight).toBeLessThanOrEqual(expanded.bioHeight + 1)
	expect(expanded.scrollWidth).toBeLessThanOrEqual(expanded.width)

	await toggle.press('Space')
	await expect(toggle).toHaveAttribute('data-i18n', 'social.feed.showMore')
	const refolded = await geometry()
	expect(refolded.bioScrollHeight).toBeGreaterThan(refolded.bioHeight + 1)
})

test('about section folds only when the bio markdown exceeds 11 lines', async ({ modulePage }) => {
	const { page } = modulePage
	/**
	 * 用指定行数的简介源文本重绘测试卡。
	 * @param {number} lineCount 源行数
	 * @returns {Promise<void>} 无返回值
	 */
	const paintLines = lineCount => modulePage.run(async count => {
		const { createEntityProfileCardElement, paintEntityProfileBio } = await import('/parts/shells:chat/shared/entityProfileCard.mjs')
		let rail = document.getElementById('profile-test-rail')
		let card = rail?.querySelector('.profile-popup')
		if (!(card instanceof HTMLElement)) {
			rail = document.createElement('aside')
			rail.id = 'profile-test-rail'
			rail.style.width = '240px'
			card = await createEntityProfileCardElement('sidebar')
			rail.append(card)
			document.body.append(rail)
		}
		await paintEntityProfileBio(card.querySelector('[data-entity-profile-bio]'), Array.from({ length: count }, (_, i) => `Line ${i + 1}`).join('\n\n'))
		await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.sheet ? Promise.resolve() : new Promise(resolve => link.addEventListener('load', resolve, { once: true }))))
	}, lineCount)

	// 11 行源文本：全文正常显示，没有展开按钮
	await paintLines(11)
	const rail = page.locator('#profile-test-rail')
	const bio = rail.locator('[data-entity-profile-bio]')
	const toggle = rail.locator('[data-profile-popup-bio-toggle]')
	await expect(bio).toBeVisible()
	await expect(bio).toContainText('Line 11')
	await expect(toggle).toBeHidden()
	expect(await bio.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)

	// 12 行源文本：折叠到前几行 + 展开按钮
	await paintLines(12)
	await expect(toggle).toBeVisible()
	await expect(toggle).toHaveAttribute('data-i18n', 'social.feed.showMore')
	expect(await bio.evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(true)

	await toggle.click()
	await expect(toggle).toHaveAttribute('data-i18n', 'social.feed.showLess')
	await expect(bio).toContainText('Line 12')
	expect(await bio.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
})

test('about section measures a paint-then-mount card once it is attached', async ({ modulePage }) => {
	const { page } = modulePage
	await modulePage.run(async () => {
		const { createEntityProfileCardElement, paintEntityProfileBio } = await import('/parts/shells:chat/shared/entityProfileCard.mjs')
		const card = await createEntityProfileCardElement('embedded')
		// 先 paint 再挂载（资料页路径）：paint 时卡片还没布局，量不到裁切
		await paintEntityProfileBio(card.querySelector('[data-entity-profile-bio]'), Array.from({ length: 20 }, (_, i) => `Paragraph ${i}: ${'long biography '.repeat(10)}`).join('\n\n'))
		const host = document.createElement('div')
		host.id = 'profile-mount-host'
		host.style.width = '320px'
		document.body.append(host)
		host.replaceChildren(card)
	})
	const host = page.locator('#profile-mount-host')
	const bio = host.locator('[data-entity-profile-bio]')
	const toggle = host.locator('[data-profile-popup-bio-toggle]')
	await expect(toggle).toBeVisible()
	// 挂载后才量得到裁切，渐隐随之补上
	await expect(host.locator('.profile-popup-bio-wrap')).toHaveClass(/is-clipped/)
	expect(await bio.evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(true)

	await toggle.click()
	await expect(toggle).toHaveAttribute('data-i18n', 'social.feed.showLess')
	await expect(bio).toContainText('Paragraph 19')
	expect(await bio.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
})

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

	test('profile popup copy link button copies entity-based DM deep link', async ({ page, baseUrl, apiKey }) => {
		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await addCharToGroup(baseUrl, apiKey, groupId, 'on_message_yes')
		await sendApiMessage(baseUrl, apiKey, groupId, channelId, `copy-link-seed ${Date.now()}`)
		await triggerCharReply(baseUrl, apiKey, groupId, channelId, 'on_message_yes')

		const replyRow = page.locator('#messages .message:not([data-pending="1"])').filter({ hasText: 'on_message_yes reply' })
		await expect(replyRow.first()).toBeVisible({ timeout: ms('1m') })
		const messageAvatar = replyRow.first().locator('.chat-image [data-avatar-for]')
		await expect(messageAvatar).toBeVisible({ timeout: ms('30s') })

		const state = await getGroupState(baseUrl, apiKey, groupId)
		const charRow = (state.meta?.members || []).find(member => member.charname === 'on_message_yes')
		expect(charRow?.entityHash).toMatch(/^[\da-f]{128}$/i)
		const entityHash = charRow.entityHash

		// 记录剪贴板写入（popup 的复制按钮经 navigator.clipboard.writeText 复制私聊深链）
		await page.evaluate(() => {
			window.__copiedTexts = []
			/**
			 * 记录被复制到剪贴板的文本。
			 * @param {string} text 被写入剪贴板的文本
			 */
			const recordWrite = (text) => { window.__copiedTexts.push(text) }
			navigator.clipboard.writeText = recordWrite
		})

		await messageAvatar.click()
		const popup = page.locator('#profile-popup-layer')
		await expect(popup).toBeVisible({ timeout: ms('30s') })
		const copyButton = popup.locator('[data-profile-popup-copy-contact]')
		await expect(copyButton).toBeVisible()
		await copyButton.click()

		const expected = formatChatDmShareUrl(entityHash)
		await expect.poll(() => page.evaluate(() => window.__copiedTexts), { timeout: ms('10s') })
			.toEqual([expected])
	})
})

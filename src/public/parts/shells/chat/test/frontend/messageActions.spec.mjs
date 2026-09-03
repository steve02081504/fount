import { ms } from 'fount/scripts/ms.mjs'
import {
	withApiRequest,
} from 'fount/scripts/test/playwright/api.mjs'

import {
	test,
	expect,
	waitForHub,
	sendMessageViaComposer,
	expectMessageInChat,
	messageRowByText,
	pickEmojiFromPicker,
	seedGroupEmojiPack,
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
 * 通过 API 向频道发送带指定 locale 的用户消息。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} text 消息正文
 * @param {string} locale 消息 locale
 * @returns {Promise<void>} 无返回值
 */
async function sendApiMessage(baseUrl, apiKey, groupId, channelId, text, locale) {
	await withApiRequest(async request => {
		const response = await request.post(
			`${baseUrl}/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/messages?fount-apikey=${encodeURIComponent(apiKey)}`,
			{ data: { content: { content: text, locale } } },
		)
		if (!response.ok()) throw new Error(`sendApiMessage failed: ${response.status()}`)
	})
}

/**
 * 通过 API 建群 emoji pack、上传一张 1×1 PNG 并加入用户收藏。
 * @param {string} baseUrl 测试根 URL
 * @param {string} apiKey API 密钥
 * @param {string} groupId 群 ID
 * @returns {Promise<string>} packId
 */
async function seedPackEmoji(baseUrl, apiKey, groupId) {
	return (await seedGroupEmojiPack(baseUrl, apiKey, groupId)).packId
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

test.describe('Chat message actions', () => {
	test.setTimeout(600_000)

	test('edits an own message', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const original = `edit-src ${Date.now()}`
		const updated = `edit-dst ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, original)
		const row = await expectMessageInChat(page, original)
		await row.hover()
		await row.locator('.message-action[data-action="edit"]').click()
		const textarea = row.locator('.message-edit-textarea')
		await expect(textarea).toBeVisible({ timeout: 20_000 })
		await expect(row.locator('.message-content')).toBeHidden({ timeout: 5_000 })
		await textarea.fill(updated)
		await row.locator('.message-edit-save').click()
		await expectMessageInChat(page, updated)
		await expect(page.locator('#messages .message').filter({ hasText: original })).toHaveCount(0, { timeout: 60_000 })
	})

	test('deletes an own message from context menu', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `del ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.click({ button: 'right' })
		await expect(page.locator('[data-message-context-menu]')).toBeVisible({ timeout: 20_000 })
		await page.locator('[data-message-context-menu] [data-action="delete"]').click()
		await expect(messageRowByText(page, text)).toHaveCount(0, { timeout: 60_000 })
	})

	test('header search filters visible messages', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const keep = `search-keep ${Date.now()}`
		const drop = `search-drop ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, keep)
		await sendMessageViaComposer(page, groupId, channelId, drop)
		await expectMessageInChat(page, keep)
		await expectMessageInChat(page, drop)
		const needle = keep.split(' ')[0]
		await page.locator('#header-search').fill(needle)
		await expect(messageRowByText(page, keep)).toBeVisible({ timeout: 30_000 })
		await expect(messageRowByText(page, drop)).toBeHidden({ timeout: 30_000 })
	})

	test('header search hits backend index and jumps to result', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		// 单词 token（索引按 latin word 分词，避免连字符被拆开后两条都命中）
		const needle = `searchneedle${Date.now()}`
		const keep = `${needle} backend hit`
		const drop = `searchother${Date.now()} backend miss`
		await sendMessageViaComposer(page, groupId, channelId, keep)
		await sendMessageViaComposer(page, groupId, channelId, drop)
		await expectMessageInChat(page, keep)

		const searchInput = page.locator('#header-search')
		const resultRow = page.locator('#search-results .search-result').filter({ hasText: needle })
		// 索引增量更新可能滞后于落盘：重填输入框重发后端查询直到命中
		await expect(async () => {
			await searchInput.fill('')
			const searchResponse = page.waitForResponse(
				res => new URL(res.url()).pathname.endsWith(`/groups/${encodeURIComponent(groupId)}/search`)
					&& res.status() === 200,
				{ timeout: 10_000 },
			)
			await searchInput.fill(needle)
			const { items } = await (await searchResponse).json()
			expect(items.some(item => String(item.text || '').includes(needle))).toBe(true)
		}).toPass({ timeout: 120_000 })

		await expect(resultRow.first()).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#search-results .search-result').filter({ hasText: 'backend miss' }))
			.toHaveCount(0)

		await resultRow.first().click()
		await expect(page.locator('#search-results')).toBeHidden({ timeout: 30_000 })
		await expect(messageRowByText(page, keep)).toBeVisible({ timeout: 30_000 })
	})

	test('pins a message to channel bar', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `pin-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await row.locator('.message-action[data-action="pin"]').click()
		await expect(page.locator('#channel-pins-bar:not([hidden]) .pinned-message-chip'))
			.toBeVisible({ timeout: 60_000 })
	})

	test('bookmarks a message in sidebar', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `bookmark-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await row.locator('.message-action[data-action="bookmark"]').click()
		await expect(page.locator('#bookmarks-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('#bookmarks-button').click()
		await expect(page.locator('#bookmarks-panel:not([hidden])')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#bookmarks-panel .bookmark-row').filter({ hasText: text.slice(0, 20) }))
			.toBeVisible({ timeout: 30_000 })
	})

	test('adds emoji reaction to a message', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `react-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await expectMessageInChat(page, text)
		const rows = page.locator('#messages .message').filter({ hasText: text })
		await rows.locator('.reactions [data-action="addReaction"]').first().click()
		await pickEmojiFromPicker(page, '👍')
		await expect(rows.locator('.reactions [data-action="reaction"]').first()).toBeVisible({ timeout: 60_000 })
		await expect(rows).toHaveCount(1, { timeout: 60_000 })
	})

	test('adds pack emoji reaction to a message', async ({ page, groupChannel, baseUrl, apiKey }) => {
		const { groupId, channelId } = groupChannel
		const packId = await seedPackEmoji(baseUrl, apiKey, groupId)
		const text = `react-pack-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		await expectMessageInChat(page, text)
		const rows = page.locator('#messages .message').filter({ hasText: text })
		await rows.locator('.reactions [data-action="addReaction"]').first().click()
		const picker = page.locator('#fount-shared-emoji-picker')
		await expect(picker).toBeVisible({ timeout: 60_000 })
		await picker.locator('[data-group-emoji-ref]').first().click()
		await expect(picker).toHaveCount(0, { timeout: 10_000 })
		const chip = rows.locator('.reactions [data-action="reaction"]').first()
		await expect(chip.locator('.reaction-emoji-img')).toBeVisible({ timeout: 60_000 })
		await expect(chip).toHaveAttribute('data-emoji', new RegExp(`:\\[emoji:${packId}/[^\\]/]+\\]:`), { timeout: 60_000 })
	})

	test('opens thread drawer and replies', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `thread-parent ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await row.locator('.message-action[data-action="thread"]').click()
		await expect(page.locator('#thread-drawer-wrap:not([hidden]) [data-thread-input]'))
			.toBeVisible({ timeout: 30_000 })
		const reply = `thread-reply ${Date.now()}`
		await page.locator('[data-thread-input]').fill(reply)
		await page.locator('[data-thread-send]').click()
		await expect(page.locator('[data-thread-msgbox] .message').filter({ hasText: reply }))
			.toBeVisible({ timeout: 60_000 })
	})

	test('shows message context menu on right click', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `context-menu ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.click({ button: 'right' })
		await expect(page.locator('[data-message-context-menu]')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('[data-message-context-menu] [data-action="copy"]')).toBeVisible()
	})

	test('copy from context menu writes message text', async ({ page, groupChannel, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		const { groupId, channelId } = groupChannel
		const text = `copy-me ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.click({ button: 'right' })
		await page.locator('[data-message-context-menu] [data-action="copy"]').click()
		await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(text)
	})

	test('bookmark row click highlights target message', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const anchor = `bookmark-scroll ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, anchor)
		const row = await expectMessageInChat(page, anchor)
		await row.hover()
		await row.locator('.message-action[data-action="bookmark"]').click()
		await expect(page.locator('#bookmarks-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('#bookmarks-button').click()
		await expect(page.locator('#bookmarks-panel:not([hidden])')).toBeVisible({ timeout: 30_000 })
		const bookmarkRow = page.locator('#bookmarks-panel .bookmark-row').filter({ hasText: anchor.slice(0, 20) })
		await expect(bookmarkRow).toBeVisible({ timeout: 30_000 })
		await bookmarkRow.click()
		await expect(row).toHaveClass(/ring-primary/, { timeout: 30_000 })
	})

	test('char reply: no edited label, respects zh-CN locale', async ({ page, groupChannel, apiKey, baseUrl }) => {
		const { groupId, channelId } = groupChannel
		await addCharToGroup(baseUrl, apiKey, groupId, 'noai_locale_reporter')
		await setUserLocale(baseUrl, apiKey, 'zh-CN')
		await sendApiMessage(baseUrl, apiKey, groupId, channelId, '请说点什么', 'zh-CN')
		await triggerCharReply(baseUrl, apiKey, groupId, channelId, 'noai_locale_reporter')

		const row = await expectMessageInChat(page, '【中文回复】', ms('3m'))
		await expect(row).toHaveAttribute('data-char-id', /./)

		// 生成终稿不应被标记为已编辑
		await expect(row.locator('[data-i18n="chat.hub.editedLabel"]')).toHaveCount(0, { timeout: 30_000 })
	})

	test('char timeline arrows are hidden by default and shown only on hover', async ({ page, baseUrl }) => {
		await waitForHub(page, baseUrl)
		await expect(page.locator('#messages')).toBeVisible({ timeout: 60_000 })
		// 直接在消息容器注入末条角色消息，避免依赖完整角色回复流（isTwoPartyCharDialogue/WS 时序）。
		await page.locator('#messages').evaluate(container => {
			container.innerHTML = ''
			const row = document.createElement('div')
			row.className = 'chat message-row'
			row.dataset.charId = 'ar'.repeat(32)
			row.innerHTML = '<span class="message-content" user-content>行</span>'
			container.appendChild(row)
			const left = document.createElement('button')
			left.type = 'button'
			left.className = 'char-timeline-arrow left'
			left.textContent = '❮'
			row.appendChild(left)
		})
		const arrow = page.locator('#messages .message-row[data-char-id] .char-timeline-arrow.left')

		// 默认隐藏（opacity 0，pointer-events none；visibility 不在其中，箭头仍可进入键盘 Tab 序）
		await expect.poll(() => page.evaluate(() => {
			const el = document.querySelector('.char-timeline-arrow.left')
			if (!el) return null
			const s = getComputedStyle(el)
			return { opacity: s.opacity, pointerEvents: s.pointerEvents }
		})).toEqual({ opacity: '0', pointerEvents: 'none' })

		// 悬停时显示
		await page.locator('#messages .message-row[data-char-id]').hover()
		await expect.poll(() => page.evaluate(() => {
			const el = document.querySelector('.char-timeline-arrow.left')
			const s = getComputedStyle(el)
			return { opacity: s.opacity, pointerEvents: s.pointerEvents }
		})).toEqual({ opacity: '0.9', pointerEvents: 'auto' })

		// 移开后恢复隐藏
		await page.mouse.move(0, 0)
		await expect.poll(() => page.evaluate(() => {
			const el = document.querySelector('.char-timeline-arrow.left')
			const s = getComputedStyle(el)
			return { opacity: s.opacity }
		})).toEqual({ opacity: '0' })

		// 键盘聚焦（行内箭头按钮触发 :focus-within）时显示
		await arrow.focus()
		await expect.poll(() => page.evaluate(() => {
			const el = document.querySelector('.char-timeline-arrow.left')
			if (!el) return null
			const s = getComputedStyle(el)
			return { opacity: s.opacity, pointerEvents: s.pointerEvents }
		})).toEqual({ opacity: '0.9', pointerEvents: 'auto' })

		// 移除焦点后恢复隐藏
		await page.mouse.click(0, 0)
		await expect.poll(() => page.evaluate(() => {
			const el = document.querySelector('.char-timeline-arrow.left')
			if (!el) return null
			const s = getComputedStyle(el)
			return { opacity: s.opacity, pointerEvents: s.pointerEvents }
		})).toEqual({ opacity: '0', pointerEvents: 'none' })
	})
})

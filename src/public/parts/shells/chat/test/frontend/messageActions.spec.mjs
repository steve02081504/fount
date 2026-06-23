import {
	test,
	expect,
	sendMessageViaComposer,
	expectMessageInChat,
	messageRowByText,
	refreshHubPinsBookmarks,
	pickEmojiFromPicker,
} from './fixtures.mjs'

test.describe('Chat message actions', () => {
	test.setTimeout(600_000)

	test('edits an own message', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const original = `edit-src ${Date.now()}`
		const updated = `edit-dst ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, original)
		const row = await expectMessageInChat(page, original)
		await row.hover()
		await row.locator('.hub-message-action[data-action="edit"]').click()
		const textarea = row.locator('.hub-message-edit-textarea')
		await expect(textarea).toBeVisible({ timeout: 20_000 })
		await textarea.fill(updated)
		await row.locator('.hub-message-edit-save').click()
		await expectMessageInChat(page, updated)
		await expect(page.locator('#hub-messages .hub-message').filter({ hasText: original })).toHaveCount(0, { timeout: 60_000 })
	})

	test('deletes an own message with shift shortcut', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `del ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await page.keyboard.down('Shift')
		await row.locator('.hub-message-action[data-action="delete"]').click()
		await page.keyboard.up('Shift')
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
		await page.locator('#hub-header-search').fill(needle)
		await expect(messageRowByText(page, keep)).toBeVisible({ timeout: 30_000 })
		await expect(messageRowByText(page, drop)).toBeHidden({ timeout: 30_000 })
	})

	test('pins a message to channel bar', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `pin-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await row.locator('.hub-message-action[data-action="pin"]').click()
		await expect(page.locator('#hub-channel-pins-bar:not([hidden]) .hub-pinned-message-chip'))
			.toBeVisible({ timeout: 60_000 })
	})

	test('bookmarks a message in sidebar', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `bookmark-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await row.locator('.hub-message-action[data-action="bookmark"]').click()
		await refreshHubPinsBookmarks(page)
		await expect(page.locator('#hub-pins-bookmarks-wrap:not([hidden])')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('.hub-bookmark-row').filter({ hasText: text.slice(0, 20) }))
			.toBeVisible({ timeout: 30_000 })
	})

	test('adds emoji reaction to a message', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `react-target ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.locator('.hub-reactions [data-action="addReaction"]').click()
		await pickEmojiFromPicker(page, '👍')
		await expect(row.locator('.hub-reactions [data-action="reaction"]')).toBeVisible({ timeout: 60_000 })
	})

	test('opens thread drawer and replies', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `thread-parent ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.hover()
		await row.locator('.hub-message-action[data-action="thread"]').click()
		await expect(page.locator('#hub-thread-drawer-wrap:not([hidden]) [data-thread-input]'))
			.toBeVisible({ timeout: 30_000 })
		const reply = `thread-reply ${Date.now()}`
		await page.locator('[data-thread-input]').fill(reply)
		await page.locator('[data-thread-send]').click()
		await expect(page.locator('[data-thread-msgbox] .hub-message').filter({ hasText: reply }))
			.toBeVisible({ timeout: 60_000 })
	})

	test('shows message context menu on right click', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const text = `ctx-menu ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await row.click({ button: 'right' })
		await expect(page.locator('[data-message-context-menu]')).toBeVisible({ timeout: 20_000 })
		await expect(page.locator('[data-message-context-menu] [data-action="copy"]')).toBeVisible()
	})
})

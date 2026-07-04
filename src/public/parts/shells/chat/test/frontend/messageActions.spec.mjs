import {
	test,
	expect,
	sendMessageViaComposer,
	expectMessageInChat,
	messageRowByText,
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
		await expect(page.locator('#hub-bookmarks-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('#hub-bookmarks-button').click()
		await expect(page.locator('#hub-bookmarks-panel:not([hidden])')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#hub-bookmarks-panel .hub-bookmark-row').filter({ hasText: text.slice(0, 20) }))
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
		await row.locator('.hub-message-action[data-action="bookmark"]').click()
		await expect(page.locator('#hub-bookmarks-button')).toBeVisible({ timeout: 30_000 })
		await page.locator('#hub-bookmarks-button').click()
		await expect(page.locator('#hub-bookmarks-panel:not([hidden])')).toBeVisible({ timeout: 30_000 })
		const bookmarkRow = page.locator('#hub-bookmarks-panel .hub-bookmark-row').filter({ hasText: anchor.slice(0, 20) })
		await expect(bookmarkRow).toBeVisible({ timeout: 30_000 })
		await bookmarkRow.click()
		await expect(row).toHaveClass(/ring-primary/, { timeout: 30_000 })
	})
})

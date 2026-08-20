import {
	test,
	expect,
	sendMessageViaComposer,
	expectMessageInChat,
} from './fixtures.mjs'

test.describe('Chat message avatar grouping', () => {
	test.setTimeout(600_000)

	test('consecutive same-author messages share one sticky avatar on the last message', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const timestamp = Date.now()
		const texts = [`avatar-a ${timestamp}`, `avatar-b ${timestamp}`, `avatar-c ${timestamp}`]
		for (const text of texts)
			await sendMessageViaComposer(page, groupId, channelId, text)
		const rows = []
		for (const text of texts)
			rows.push(await expectMessageInChat(page, text))

		// 连续同作者（30min 内）合并为一组：整组只显示一个共享头像
		await expect(page.locator('#messages .chat-image:visible')).toHaveCount(1, { timeout: 30_000 })

		// 头像落在末条消息行，且 sticky 在可视区底部
		const lastRow = rows[2]
		await expect(lastRow).toHaveClass(/last-in-group/)
		await expect(lastRow.locator('.chat-image')).toBeVisible()
		await expect(lastRow.locator('.chat-image')).toHaveCSS('position', 'sticky')

		// 非末条消息的头像隐藏
		await expect(rows[0]).not.toHaveClass(/last-in-group/)
		await expect(rows[0].locator('.chat-image')).toBeHidden()
		await expect(rows[1]).not.toHaveClass(/last-in-group/)
		await expect(rows[1].locator('.chat-image')).toBeHidden()

		// 昵称行只出现在分组首条消息（first-in-group 仅作分组标记校验）
		await expect(rows[0]).toHaveClass(/first-in-group/)
		await expect(rows[0].locator('.message-author')).toBeVisible()
		await expect(rows[1]).not.toHaveClass(/first-in-group/)
		await expect(rows[1].locator('.message-author')).toBeHidden()
		await expect(rows[2]).not.toHaveClass(/first-in-group/)
		await expect(rows[2].locator('.message-author')).toBeHidden()
	})

	test('single message carries both first-in-group and last-in-group with a visible avatar', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const timestamp = Date.now()
		const text = `avatar-solo ${timestamp}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await expect(row).toHaveClass(/first-in-group/)
		await expect(row).toHaveClass(/last-in-group/)
		await expect(row.locator('.chat-image')).toBeVisible()
	})

	test('a tall single message keeps its avatar stuck at the visible bottom', async ({ page, groupChannel }) => {
		const { groupId, channelId } = groupChannel
		const timestamp = Date.now()
		const text = `tall-avatar ${timestamp}\n${Array.from({ length: 90 }, (_, index) => `line ${index}`).join('\n')}`
		await sendMessageViaComposer(page, groupId, channelId, text)
		const row = await expectMessageInChat(page, text)
		await expect(row).toHaveClass(/last-in-group/)
		const avatar = row.locator('.chat-image')

		// 滚动到消息底边（略低于可视区底缘），消息底边仍在可视区之下：
		// sticky 应把头像钉在可视区底部；若包含块被网格限制在消息中段则头像会停在中段/移出可视区。
		const messageId = await row.getAttribute('data-message-id')
		const box = await page.evaluate((messageId) => {
			const container = document.querySelector('#messages')
			const messageRow = container.querySelector(`.message-row.last-in-group[data-message-id="${messageId}"]`)
			container.scrollTop = (messageRow.offsetTop + messageRow.offsetHeight) - container.clientHeight - 40
			const avatarElement = messageRow.querySelector('.chat-image')
			const rect = avatarElement.getBoundingClientRect()
			const rowRect = messageRow.getBoundingClientRect()
			const containerRect = container.getBoundingClientRect()
			return {
				containerBottom: containerRect.bottom,
				rowBottom: rowRect.bottom,
				avatarY: rect.y,
				avatarH: rect.height,
				alignSelf: window.getComputedStyle(avatarElement).alignSelf,
			}
		}, messageId)
		await expect(avatar).toBeVisible()
		const avatarBottom = box.avatarY + box.avatarH

		// 确保仍在 sticky 阶段：消息底边依然在可视区之下。
		expect(box.rowBottom).toBeGreaterThan(box.containerBottom + 20)
		// 头像底边应贴在可视区底部附近。
		expect(avatarBottom).toBeGreaterThanOrEqual(box.containerBottom - 20)
		// 回归：`.avatar` 的 `align-self: center` 不得覆盖底部对齐，否则头像会停在消息中段。
		expect(box.alignSelf).toBe('flex-end')
	})
})

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
		const debug = await page.locator('#messages .message-row').evaluateAll(rows =>
			rows.map(row => {
				const img = row.querySelector('.chat-image')
				const cs = img ? getComputedStyle(img) : null
				return {
					cls: row.className,
					vis: cs?.visibility,
					pos: cs?.position,
				}
			}),
		)
		console.error('AVATAR_DEBUG ' + JSON.stringify(debug, null, 2))
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

		// 昵称行只出现在分组首条消息
		await expect(rows[0]).toHaveClass(/first-in-group/)
		await expect(rows[1]).not.toHaveClass(/first-in-group/)
		await expect(rows[2]).not.toHaveClass(/first-in-group/)
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
})

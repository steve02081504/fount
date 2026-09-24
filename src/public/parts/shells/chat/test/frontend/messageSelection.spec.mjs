/**
 * 消息多选（前端实跑）：原生文字选择跨消息自动升变、选中高亮、浮动工具条、Ctrl+C 复制、点空白取消。
 */
import { expect, sendMessageViaComposer, expectMessageInChat, test } from './fixtures.mjs'

test.describe('Chat message multi-select', () => {
	test.setTimeout(600_000)

	test('native selection across messages upgrades, highlights and copies', async ({ page, groupChannel, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])

		const { groupId, channelId } = groupChannel
		const a = `msel-a ${Date.now()}`
		const b = `msel-b ${Date.now()}`
		const c = `msel-c ${Date.now()}`
		await sendMessageViaComposer(page, groupId, channelId, a)
		await sendMessageViaComposer(page, groupId, channelId, b)
		await sendMessageViaComposer(page, groupId, channelId, c)
		await expectMessageInChat(page, a)
		await expectMessageInChat(page, c)

		const ids = await page.evaluate(({ aText, cText }) => {
			const rows = [...document.querySelectorAll('#messages .message-row[data-message-id]')]
			const rowA = rows.find(row => row.textContent.includes(aText))
			const rowC = rows.find(row => row.textContent.includes(cText))
			const startEl = rowA.querySelector('.message-content')
			const endEl = rowC.querySelector('.message-content')
			const range = document.createRange()
			range.setStart(startEl, 0)
			range.setEnd(endEl, endEl.childNodes.length)
			const selection = window.getSelection()
			selection.removeAllRanges()
			selection.addRange(range)
			document.dispatchEvent(new Event('selectionchange'))
			return { a: rowA.getAttribute('data-message-id'), c: rowC.getAttribute('data-message-id') }
		}, { aText: a, cText: c })

		const toolbar = page.locator('.message-selection-toolbar')
		await expect(toolbar).toBeVisible({ timeout: 10_000 })
		await expect(page.locator(`.message-row[data-message-id="${ids.a}"]`)).toHaveClass(/is-selected/)
		await expect(page.locator(`.message-row[data-message-id="${ids.c}"]`)).toHaveClass(/is-selected/)
		await expect(toolbar.locator('.message-selection-count')).toContainText('3')

		await toolbar.locator('.message-selection-copy').click()
		await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain(a)
		const clip = await page.evaluate(() => navigator.clipboard.readText())
		expect(clip).toContain(b)
		expect(clip).toContain(c)

		await page.locator('#messages').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
		await expect(toolbar).toBeHidden({ timeout: 10_000 })
	})
})

import {
	test,
	expect,
} from './fixtures.mjs'

const ENTITY_HASH = 'f'.repeat(128)

test.describe('Markdown rich input', () => {
	test('clicking empty composer places caret at start (before placeholder)', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		const caret = await page.evaluate(() => {
			const node = document.getElementById('message-input')
			const sel = globalThis.getSelection()
			if (!sel || sel.rangeCount === 0) return null
			return {
				atStart: sel.anchorNode === node && sel.anchorOffset === 0,
				offset: sel.anchorOffset,
			}
		})
		expect(caret).toEqual({ atStart: true, offset: 0 })
	})

	test('typing into empty composer does not prepend a newline', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('hello')
		await expect(input).toHaveValue('hello')
	})

	test('clearing text restores placeholder', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		const placeholder = input.locator('.fount-markdown-rich-input-placeholder')
		await input.click()
		await expect(placeholder).toHaveCount(1)
		await page.keyboard.type('hello')
		await expect(placeholder).toHaveCount(0)
		await page.keyboard.press('Control+A')
		await page.keyboard.press('Delete')
		await expect(input).toHaveValue('')
		await expect(placeholder).toHaveCount(1)
	})

	test('@ with query shows mention panel', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('@z')
		await expect(page.locator('.mention-panel')).toBeVisible()
	})

	test('mention token renders as inline chip and round-trips to raw text', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		const raw = `@[entity:${ENTITY_HASH}]`
		await input.fill(raw)
		await expect(input.locator('.fount-markdown-rich-input-chip.fount-markdown-rich-input-mention')).toHaveCount(1)
		await expect(input).toHaveValue(raw)
	})

	test('custom emoji token renders inline emoji element', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.fill(':[emoji:testpack/grinning]:')
		await expect(input.locator('.fount-markdown-rich-input-chip.fount-markdown-rich-input-emoji')).toHaveCount(1)
	})
})

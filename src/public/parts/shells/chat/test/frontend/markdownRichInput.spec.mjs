import {
	test,
	expect,
} from './fixtures.mjs'

const ENTITY_HASH = 'f'.repeat(128)

/**
 * 自定义文件 token 解析（code shell 场景）。
 * @param {string} raw 原始 token
 * @returns {{ kind: 'file', body: string, name: string }} token 描述
 */
function parseFileToken(raw) {
	return { kind: 'file', body: raw, name: raw.slice(6, -1) }
}

/**
 * 自定义文件 token chip 标签。
 * @param {{ name: string }} token token 描述
 * @returns {string} 标签
 */
function fileTokenLabel(token) {
	return token.name
}

test.describe('Markdown rich input', () => {
	test('clicking empty composer places caret at start (before placeholder)', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		const caret = await page.evaluate(() => {
			const node = document.getElementById('message-input')
			const sel = globalThis.getSelection()
			if (!sel || sel.rangeCount === 0) return null
			return {
				atStart: sel.anchorNode === node.firstChild && sel.anchorOffset === 0,
				offset: sel.anchorOffset,
			}
		})
		expect(caret).toEqual({ atStart: true, offset: 0 })
	})

	test('typing into empty composer does not prepend a newline', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('hello')
		await expect(input).toHaveJSProperty('value', 'hello')
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
		await expect(input).toHaveJSProperty('value', '')
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
		await expect(input).toHaveJSProperty('value', raw)
	})

	test('custom emoji token renders inline emoji element', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.fill(':[emoji:testpack/grinning]:')
		await expect(input.locator('.fount-markdown-rich-input-chip.fount-markdown-rich-input-emoji')).toHaveCount(1)
	})

	test('inlineTokens option renders custom token chip without registered defaults', async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			document.body.appendChild(el)
			const handle = createMarkdownRichInput(el, {
				useRegisteredInlineTokens: false,
				inlineTokens: [{
					kind: 'file',
					regex: /@file:([\w.-]+)\]/giu,
					parse: parseFileToken,
					resolveLabel: fileTokenLabel,
				}],
			})
			handle.value = '@file:main.mjs]'
			await new Promise(resolve => setTimeout(resolve, 0))
			const fileChipCount = el.querySelectorAll('.fount-markdown-rich-input-file').length
			const roundTrip = handle.value === '@file:main.mjs]'
			handle.value = `@[entity:${'f'.repeat(128)}]`
			await new Promise(resolve => setTimeout(resolve, 0))
			const mentionChipCount = el.querySelectorAll('.fount-markdown-rich-input-mention').length
			el.remove()
			return { fileChipCount, roundTrip, mentionChipCount }
		})
		expect(result).toEqual({ fileChipCount: 1, roundTrip: true, mentionChipCount: 0 })
	})

	test('useRegisteredInlineTokens=false keeps registered mention token as plain text', async ({ page }) => {
		const result = await page.evaluate(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			document.body.appendChild(el)
			const handle = createMarkdownRichInput(el, { useRegisteredInlineTokens: false })
			handle.value = `@[entity:${'f'.repeat(128)}]`
			await new Promise(resolve => setTimeout(resolve, 0))
			const mentionChipCount = el.querySelectorAll('.fount-markdown-rich-input-mention').length
			const roundTrip = handle.value === `@[entity:${'f'.repeat(128)}]`
			el.remove()
			return { mentionChipCount, roundTrip }
		})
		expect(result).toEqual({ mentionChipCount: 0, roundTrip: true })
	})

	test('toolbar link action wraps selection and fires input event', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('fount')
		await page.keyboard.press('Control+A')
		const toolbar = page.locator('.fount-markdown-rich-input-toolbar:not(.hidden)')
		await expect(toolbar).toBeVisible()
		await input.evaluate(node => {
			window.__richInputEvents = 0
			node.addEventListener('input', () => { window.__richInputEvents += 1 })
		})
		await toolbar.locator('[data-action="link"]').click()
		await expect(page.locator('#promptInput')).toBeVisible()
		await page.locator('#promptInput').fill('https://example.com')
		await page.locator('[data-dialog-resolve="ok"]').click()
		await expect(input).toHaveJSProperty('value', '[fount](https://example.com)')
		const count = await input.evaluate(() => window.__richInputEvents)
		expect(count).toBeGreaterThan(0)
	})

	test('Ctrl+Z undoes and Ctrl+Y / Ctrl+Shift+Z redo typed text', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('hello')
		await expect(input).toHaveJSProperty('value', 'hello')
		await page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', 'hell')
		await page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', 'hel')
		await page.keyboard.press('Control+Y')
		await expect(input).toHaveJSProperty('value', 'hell')
		await page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', 'hel')
		await page.keyboard.press('Control+Shift+Z')
		await expect(input).toHaveJSProperty('value', 'hell')
	})

	test('pasting http(s) link over selection converts to markdown link', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('fount')
		await page.keyboard.press('Control+A')
		await input.evaluate(node => {
			const dt = new DataTransfer()
			dt.setData('text/plain', 'https://example.com')
			node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
		})
		await expect(input).toHaveJSProperty('value', '[fount](https://example.com)')
	})

	test('pasting non-url text over selection stays plain replacement', async ({ page, groupChannel: _ }) => {
		const input = page.locator('#message-input')
		await input.click()
		await page.keyboard.type('fount')
		await page.keyboard.press('Control+A')
		await input.evaluate(node => {
			const dt = new DataTransfer()
			dt.setData('text/plain', 'replacement')
			node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
		})
		await expect(input).toHaveJSProperty('value', 'replacement')
	})
})

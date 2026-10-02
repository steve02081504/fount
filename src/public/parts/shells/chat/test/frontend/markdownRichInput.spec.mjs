import {
	test,
	expect,
	seedGroupEmojiPack,
} from './fixtures.mjs'

const ENTITY_HASH = 'f'.repeat(128)

test.describe('Markdown rich input', () => {
	test('language fences highlight while native editing, selection and clipboard preserve markdown', async ({ modulePage }) => {
		const raw = 'before\n```JS\nconst value = "<b>hello</b>";\n\nconsole.log(value)\n```\nafter'
		await modulePage.run(async raw => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			el.id = 'highlight-input'
			document.body.appendChild(el)
			createMarkdownRichInput(el, { useRegisteredInlineTokens: false, enableToolbar: false }).value = raw
			el.focus()
			el.setSelectionRange(raw.indexOf('value'), raw.indexOf('value') + 5)
		}, raw)
		const input = modulePage.page.locator('#highlight-input')
		const tokens = input.locator('.fount-markdown-rich-input-code-token')
		await expect(tokens.first()).toBeVisible()
		await expect(input).toHaveJSProperty('value', raw)
		const result = await input.evaluate(el => {
			const clipboard = new DataTransfer()
			el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true, cancelable: true }))
			return {
				selected: [el.selectionStart, el.selectionEnd],
				copied: clipboard.getData('text/plain'),
				colors: new Set([...el.querySelectorAll('.fount-markdown-rich-input-code-token')].map(node => getComputedStyle(node).color)).size,
				html: el.querySelector('b') !== null,
			}
		})
		expect(result.selected).toEqual([raw.indexOf('value'), raw.indexOf('value') + 5])
		expect(result.copied).toBe('value')
		expect(result.colors).toBeGreaterThan(1)
		expect(result.html).toBe(false)
		const themeColors = await tokens.first().evaluate(node => {
			const root = document.documentElement
			const original = root.getAttribute('color-scheme')
			root.setAttribute('color-scheme', 'only light')
			const light = getComputedStyle(node).color
			root.setAttribute('color-scheme', 'only dark')
			const dark = getComputedStyle(node).color
			if (original === null) root.removeAttribute('color-scheme')
			else root.setAttribute('color-scheme', original)
			return { light, dark }
		})
		expect(themeColors.light).not.toBe(themeColors.dark)
		await modulePage.page.keyboard.type('answer')
		const edited = raw.replace('value', 'answer')
		await expect(input).toHaveJSProperty('value', edited)
		await expect(tokens.first()).toBeVisible()
		await modulePage.page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', raw.replace('value', 'answe'))
		await modulePage.page.keyboard.press('Control+Y')
		await expect(input).toHaveJSProperty('value', edited)
		await input.locator('button').click()
		await expect(tokens).toHaveCount(0)
		await input.locator('button').click()
		await expect(tokens.first()).toBeVisible()
		await input.evaluate(el => { el.value = '```unknown-language\nconst value = 1\n```\n```\nplain\n```' })
		await expect(tokens).toHaveCount(0)
		await expect(input).toHaveJSProperty('value', '```unknown-language\nconst value = 1\n```\n```\nplain\n```')
	})

	test('typed fences close automatically, enter moves into body and nested fences grow the outer pair', async ({ modulePage }) => {
		await modulePage.run(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			document.body.appendChild(el)
			createMarkdownRichInput(el, { useRegisteredInlineTokens: false, enableToolbar: false })
			el.id = 'fence-input'
			el.focus()
		})
		const page = modulePage.page
		const input = page.locator('#fence-input')
		await page.keyboard.type('```js')
		await expect(input).toHaveJSProperty('value', '```js\n\n```')
		await page.keyboard.press('Enter')
		await page.keyboard.type('```')
		await expect(input).toHaveJSProperty('value', '````js\n```\n\n```\n````')
		await page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', '```js\n``\n```')
		await page.keyboard.press('Control+Y')
		await expect(input).toHaveJSProperty('value', '````js\n```\n\n```\n````')
		await input.evaluate(el => el.setSelectionRange(11, 11))
		await page.keyboard.type('```')
		await expect(input).toHaveJSProperty('value', '`````js\n````\n```\n\n```\n````\n`````')
		await input.evaluate(el => { el.value = 'inline ' })
		await page.keyboard.type('```')
		await expect(input).toHaveJSProperty('value', 'inline ```')
	})

	test('lengthening opening fences updates their closing fences and enclosing pairs', async ({ modulePage }) => {
		await modulePage.run(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			el.id = 'lengthen-fence-input'
			document.body.appendChild(el)
			createMarkdownRichInput(el, { useRegisteredInlineTokens: false, enableToolbar: false })
			el.focus()
		})
		const page = modulePage.page
		const input = page.locator('#lengthen-fence-input')
		await page.keyboard.type('`````js')
		await expect(input).toHaveJSProperty('value', '`````js\n\n`````')
		await input.evaluate(el => el.setSelectionRange(5, 5))
		await page.keyboard.type('`')
		await expect(input).toHaveJSProperty('value', '``````js\n\n``````')
		await expect(input).toHaveJSProperty('selectionStart', 6)
		await page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', '`````js\n\n`````')
		await page.keyboard.press('Control+Y')
		await expect(input).toHaveJSProperty('value', '``````js\n\n``````')
		await input.evaluate(el => {
			el.value = '````\n```\nbody\n```\n````'
			el.setSelectionRange(8, 8)
		})
		await page.keyboard.type('`')
		await expect(input).toHaveJSProperty('value', '`````\n````\nbody\n````\n`````')
		await expect(input).toHaveJSProperty('selectionStart', 10)
		await input.evaluate(el => {
			el.value = '  ```js\nbody\n  `````\nafter'
			el.setSelectionRange(3, 4)
		})
		await page.keyboard.type('``')
		await expect(input).toHaveJSProperty('value', '  ````js\nbody\n  `````\nafter')
		await page.keyboard.type('``')
		await expect(input).toHaveJSProperty('value', '  ``````js\nbody\n  ``````\nafter')
	})

	test('deleting fence ticks updates the pair and collapses empty blocks', async ({ modulePage }) => {
		await modulePage.run(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			el.id = 'delete-fence-input'
			document.body.appendChild(el)
			createMarkdownRichInput(el, { useRegisteredInlineTokens: false, enableToolbar: false })
			el.focus()
		})
		const page = modulePage.page
		const input = page.locator('#delete-fence-input')
		await page.keyboard.type('```')
		await page.keyboard.press('Backspace')
		await expect(input).toHaveJSProperty('value', '``')
		await expect(input).toHaveJSProperty('selectionStart', 2)
		await page.keyboard.press('Control+Z')
		await expect(input).toHaveJSProperty('value', '```\n\n```')
		await page.keyboard.press('Control+Y')
		await expect(input).toHaveJSProperty('value', '``')
		await input.evaluate(el => {
			el.value = 'before\n  `````js\nbody\n  `````\nafter'
			el.setSelectionRange(14, 14)
		})
		await page.keyboard.press('Backspace')
		await expect(input).toHaveJSProperty('value', 'before\n  ````js\nbody\n  ````\nafter')
		await input.evaluate(el => {
			el.value = '````\nbody\n````'
			el.setSelectionRange(10, 10)
		})
		await page.keyboard.press('Delete')
		await expect(input).toHaveJSProperty('value', '```\nbody\n```')
		await expect(input).toHaveJSProperty('selectionStart', 9)
		await input.evaluate(el => {
			el.value = '```\n\n```'
			el.setSelectionRange(8, 8)
		})
		await page.keyboard.press('Backspace')
		await expect(input).toHaveJSProperty('value', '``')
		await expect(input).toHaveJSProperty('selectionStart', 2)
		await input.evaluate(el => {
			el.value = '```js\nbody\n```\nafter'
			el.setSelectionRange(1, 3)
		})
		await page.keyboard.press('Backspace')
		await expect(input).toHaveJSProperty('value', '`js\nbody\nafter')
		await input.evaluate(el => { el.value = 'inline ```' })
		await page.keyboard.press('Backspace')
		await expect(input).toHaveJSProperty('value', 'inline ``')
	})

	test('folding preserves raw selection, clipboard text and editing after expansion', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			document.body.appendChild(el)
			const handle = createMarkdownRichInput(el, { useRegisteredInlineTokens: false, enableToolbar: false })
			const raw = 'before\n```js\n@[entity:literal]\n```\nafter'
			handle.value = raw
			el.querySelector('button').click()
			const folded = el.querySelector('[data-raw]')?.dataset.raw
			el.setSelectionRange(7, raw.length - 6)
			const selected = [handle.selectionStart, handle.selectionEnd]
			const clipboard = new DataTransfer()
			el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: clipboard, bubbles: true, cancelable: true }))
			const copied = clipboard.getData('text/plain')
			el.querySelector('button').click()
			handle.setRangeText('x', 13, 13)
			return { folded, selected, copied, edited: handle.value }
		})
		expect(result).toEqual({
			folded: '```js\n@[entity:literal]\n```',
			selected: [7, 34],
			copied: '```js\n@[entity:literal]\n```',
			edited: 'before\n```js\nx@[entity:literal]\n```\nafter',
		})
	})

	test('pasted longer fences grow both outer boundaries and inline backticks stay unchanged', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			document.body.appendChild(el)
			const handle = createMarkdownRichInput(el, { useRegisteredInlineTokens: false, enableToolbar: false })
			handle.value = '  ```md\n\n  ```\ntail'
			el.setSelectionRange(8, 8)
			const clipboard = new DataTransfer()
			clipboard.setData('text/plain', '`````js\nx\n`````')
			el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
			const nested = handle.value
			handle.value = 'text ``'
			handle.setRangeText('`', 7, 7)
			return { nested, inline: handle.value }
		})
		expect(result).toEqual({ nested: '  ``````md\n`````js\nx\n`````\n  ``````\ntail', inline: 'text ```' })
	})

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

	test('custom emoji token renders inline emoji element', async ({ page, baseUrl, apiKey, groupChannel }) => {
		const { groupId } = groupChannel
		// 用真实 pack：chip 会按 emojiRef 请求内容，虚构 packId 会产生 404 网络噪声。
		const { packId, emojiId } = await seedGroupEmojiPack(baseUrl, apiKey, groupId)
		const input = page.locator('#message-input')
		await input.fill(`:[emoji:${packId}/${emojiId}]:`)
		await expect(input.locator('.fount-markdown-rich-input-chip.fount-markdown-rich-input-emoji')).toHaveCount(1)
	})

	test('inlineTokens option renders custom token chip without registered defaults', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
		const result = await page.evaluate(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			/**
			 * 自定义文件 token 解析（code shell 场景）。
			 * @param {string} raw 原始 token
			 * @returns {{ kind: 'file', body: string, name: string }} token 描述
			 */
			const parseFileToken = raw => ({ kind: 'file', body: raw, name: raw.slice(6, -1) })
			/**
			 * 自定义文件 token chip 标签。
			 * @param {{ name: string }} token token 描述
			 * @returns {string} 标签
			 */
			const fileTokenLabel = token => token.name
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

	test('useRegisteredInlineTokens=false keeps registered mention token as plain text', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
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

	test('setSuffixHint renders after text before the trailing <br> and clears on change', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:chat/hub/`, { waitUntil: 'domcontentloaded' })
		const result = await page.evaluate(async () => {
			const { createMarkdownRichInput } = await import('/scripts/components/markdownRichInput.mjs')
			const el = document.createElement('div')
			document.body.appendChild(el)
			const handle = createMarkdownRichInput(el, { useRegisteredInlineTokens: false })
			handle.value = 'echo h'
			handle.setSuffixHint('ello-world')
			const hint = el.querySelector('.fount-markdown-rich-input-suffix-hint')
			const renderedText = hint?.textContent
			const afterTextNode = hint?.previousSibling?.nodeType === Node.TEXT_NODE
			const beforeTrailingBr = hint?.nextSibling?.tagName === 'BR'
			const valueExcludesHint = handle.value === 'echo h'
			// 内容改变后提示自动失效
			handle.value = 'echo hi'
			const staleGone = el.querySelector('.fount-markdown-rich-input-suffix-hint') === null
			// 末尾换行时提示落到新起的空行
			handle.value = 'echo\n'
			handle.setSuffixHint('next')
			const trailingHint = el.querySelector('.fount-markdown-rich-input-suffix-hint')?.textContent
			handle.setSuffixHint('')
			const cleared = el.querySelector('.fount-markdown-rich-input-suffix-hint') === null
			const suffixHint = handle.suffixHint
			el.remove()
			return { renderedText, afterTextNode, beforeTrailingBr, valueExcludesHint, staleGone, trailingHint, cleared, suffixHint }
		})
		expect(result).toEqual({
			renderedText: 'ello-world',
			afterTextNode: true,
			beforeTrailingBr: true,
			valueExcludesHint: true,
			staleGone: true,
			trailingHint: 'next',
			cleared: true,
			suffixHint: '',
		})
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

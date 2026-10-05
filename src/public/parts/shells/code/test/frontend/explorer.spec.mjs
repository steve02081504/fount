/** 文件浏览器和编辑器共用会话标签栏。 */
import { readFileSync } from 'node:fs'

import { test, expect } from './fixtures.mjs'
import { API_BASE, holdLocale, releaseLocale, leftoverWorkspaceDirs, makeWorkspace, openCode, removeAllWorkspacesViaApi, rmDirRetry, selectWorkspaceViaBrowser, useLeftoverWorkspaceCleanup } from './helpers.mjs'

useLeftoverWorkspaceCleanup(test)

test('file tree opens a file tab, previews changes, saves, and returns to the agent tab', async ({ page, baseUrl }) => {
	const dir = makeWorkspace('explorer', { 'src/note.txt': 'first\nsecond\n' })
	leftoverWorkspaceDirs.add(dir)
	try {
		await openCode(page, baseUrl)
		await holdLocale(page)
		await selectWorkspaceViaBrowser(page, dir)
		await expect(page.locator('#code-explorer-tree .code-tree-row')).toContainText(['src'])
		await page.locator('#code-explorer-tree .code-tree-row', { hasText: 'src' }).click()
		await page.locator('#code-explorer-tree .code-tree-row', { hasText: 'note.txt' }).click()
		await expect(page.locator('#tab-strip .code-tab')).toHaveCount(2)
		await expect(page.locator('#code-editor')).toBeVisible()
		await expect(page.locator('#code-editor-input .monaco-editor .view-line')).toHaveText(['first', 'second', ''])
		// 行数由 i18n 文案自己插值（`${count} 行`）：尾随换行也算一行
		await expect(page.locator('#code-editor-status')).toContainText('3 行')
		await page.locator('#code-editor-input .monaco-editor').click()
		await page.keyboard.press('Control+A')
		await page.keyboard.insertText('first\nchanged\n')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeVisible()
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-main > :first-child')).toHaveClass('code-tab-dirty')
		await expect(page.locator('.code-editor-head, #code-editor-summary')).toHaveCount(0)
		await page.keyboard.press('Control+s')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeHidden()
		expect(readFileSync(`${dir}/src/note.txt`, 'utf8')).toBe('first\nchanged\n')
		await page.reload()
		await holdLocale(page)
		await expect(page.locator('.code-main')).toHaveClass(/file-view/)
		await expect(page.locator('.code-main')).not.toHaveClass(/empty-mode/)
		await expect(page.locator('#code-editor')).toBeVisible()
		await expect(page.locator('#messages')).toBeHidden()
		await expect(page.locator('.code-composer')).toBeHidden()
		await page.locator('#code-editor-input .monaco-editor').click()
		await page.keyboard.press('Control+A')
		await page.keyboard.insertText('first\nchanged\n')
		await page.keyboard.press('Control+End')
		await page.keyboard.insertText('auto')
		await page.locator('#tab-strip .code-tab').first().locator('.code-tab-main').click()
		await expect.poll(() => readFileSync(`${dir}/src/note.txt`, 'utf8')).toBe('first\nchanged\nauto')
		await page.locator('#tab-strip .code-tab-main', { hasText: 'note.txt' }).click()
		await page.locator('#code-editor-input .monaco-editor').click()
		await page.keyboard.press('Control+A')
		await page.keyboard.insertText('first\nchanged\n')
		await page.evaluate(() => window.dispatchEvent(new Event('blur')))
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeHidden()
		await expect.poll(() => readFileSync(`${dir}/src/note.txt`, 'utf8')).toBe('first\nchanged\n')
		await page.locator('#tab-strip .code-tab').first().locator('.code-tab-main').click()
		await expect(page.locator('#code-editor')).toBeHidden()
		await expect(page.locator('#composer-input')).toBeVisible()
		await page.evaluate(async () => {
			const [{ store }, { renderMessages }] = await Promise.all([
				import('/parts/shells:code/src/store.mjs'),
				import('/parts/shells:code/src/messages.mjs'),
			])
			store.session.entries.push({
				id: 'edit-summary',
				role: 'tool',
				name: 'file-operations.replace-file',
				content: '文件 `src/note.txt` 内容已修改。',
				extension: { pluginData: { 'file-operations': { edit: { path: 'src/note.txt', added: 1, removed: 1, diff: '@@ 2 @@\n-second\n+changed' } } } },
			})
			store.session.entries.push({
				id: 'remote-edit-summary', role: 'tool', name: 'file-operations.replace-file', content: 'remote edit',
				extension: {
					executionTarget: { machine: 'unknown-remote-machine', workdir: '/remote/workspace' },
					pluginData: { 'file-operations': { edit: { path: 'src/note.txt', added: 1, removed: 1, diff: '-remote\n+changed' } } },
				},
			})
			renderMessages()
		})
		await expect(page.locator('.code-change-summary')).toContainText('src/note.txt')
		await expect(page.locator('.code-change-summary')).toContainText('+1')
		await expect(page.locator('.code-change-file')).toHaveCount(2)
		await expect(page.locator('.code-change-file').last()).toBeDisabled()
		await page.locator('.code-change-file').first().hover()
		await expect(page.locator('.code-change-preview')).toContainText('-second')
		await expect(page.locator('.code-change-preview')).toContainText('+changed')
		await page.locator('.code-change-file').first().click()
		await expect(page.locator('#code-editor-input .monaco-editor .view-line')).toHaveText(['first', 'changed', ''])
		await expect(async () => {
			const data = await (await page.request.get(`${baseUrl}${API_BASE}/tabs`)).json()
			expect(data.tabs.some(tab => tab.type === 'file' && tab.id === 'src/note.txt')).toBe(true)
		}).toPass()
		await removeAllWorkspacesViaApi(page, baseUrl)
	}
	finally { await releaseLocale(page); await rmDirRetry(dir) }
})


test('large files render a bounded viewport, retain undo across tabs, and expose editor commands', async ({ page, baseUrl }) => {
	const content = Array.from({ length: 50000 }, (_, index) => `const item${index} = "文本-${index}";`).join('\n')
	const dir = makeWorkspace('editor-large', { 'large.js': content, 'small.txt': 'unchanged\r\nsecond\r\n' })
	leftoverWorkspaceDirs.add(dir)
	try {
		await openCode(page, baseUrl)
		await holdLocale(page)
		await selectWorkspaceViaBrowser(page, dir)
		await page.locator('#code-explorer-tree .code-tree-row', { hasText: 'large.js' }).click()
		const editor = page.locator('#code-editor-input .monaco-editor')
		await expect(editor).toBeVisible()
		await expect(page.locator('#code-editor-status')).toContainText('50000 行')
		expect(await page.locator('#code-editor-input .monaco-editor .view-line').count()).toBeLessThan(250)
		await editor.click()
		await page.keyboard.press('Control+End')
		await page.keyboard.insertText(' // tail edit')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeVisible()
		await page.locator('#code-explorer-tree .code-tree-row', { hasText: 'small.txt' }).click()
		await expect.poll(() => readFileSync(`${dir}/large.js`, 'utf8')).toBe(`${content} // tail edit`)
		await expect(page.locator('#code-editor-input .monaco-editor .view-line')).toHaveText(['unchanged', 'second', ''])
		await page.locator('#code-editor-input .monaco-editor').click()
		await page.keyboard.press('Control+Home')
		await page.keyboard.insertText('prefix ')
		await page.keyboard.press('Control+s')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeHidden()
		expect(readFileSync(`${dir}/small.txt`, 'utf8')).toBe('prefix unchanged\r\nsecond\r\n')
		await page.locator('#tab-strip .code-tab-main', { hasText: 'large.js' }).click()
		await editor.locator('.view-lines').click({ button: 'right' })
		await expect(page.getByRole('menuitem', { name: /保存/ })).toBeVisible()
		await page.keyboard.press('Escape')
		await editor.click()
		await page.keyboard.press('Control+f')
		await expect(page.locator('#code-editor-input .monaco-editor .find-widget')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.locator('#code-editor-input .monaco-editor .find-widget')).toHaveAttribute('aria-hidden', 'true')
		const undoBefore = await page.evaluate(async () => {
			const { loadCodeRuntime } = await import('/scripts/components/codeSyntax.mjs')
			const editor = (await loadCodeRuntime()).editor.getEditors()[0]
			editor.focus()
			return { hasTextFocus: editor.hasTextFocus(), version: editor.getModel().getAlternativeVersionId(), tail: editor.getModel().getValue().slice(-30) }
		})
		expect(undoBefore.hasTextFocus).toBe(true)
		expect(undoBefore.tail).toContain('// tail edit')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeHidden()
		await page.keyboard.press('Control+z')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeVisible()
		await page.keyboard.press('Control+Shift+z')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeHidden()
		await page.keyboard.press('Control+z')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeVisible()
		await page.keyboard.press('Control+Shift+z')
		await expect(page.locator('.code-tab[data-active="true"] .code-tab-dirty')).toBeHidden()
		await expect.poll(() => readFileSync(`${dir}/large.js`, 'utf8')).toBe(`${content} // tail edit`)
		expect(readFileSync(`${dir}/large.js`, 'utf8')).toBe(`${content} // tail edit`)
		expect(await page.locator('#code-editor-input .monaco-editor .view-line').count()).toBeLessThan(250)
		await removeAllWorkspacesViaApi(page, baseUrl)
	} finally { await releaseLocale(page); await rmDirRetry(dir) }
})

test('virtual row queues bound DOM size and reach the last row after resizing', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { windowedRows } = await import('/parts/shells:code/src/windowedRows.mjs')
		const host = document.createElement('div')
		host.style.cssText = 'height:280px;overflow:auto'
		document.body.append(host)
		const queue = windowedRows(host, {
			height: 28,
			/**
			 * 创建用于验证虚拟队列的行。
			 * @param {{name: string}} item - 测试数据。
			 * @returns {HTMLElement} 行元素。
			 */
			render: item => {
				const row = document.createElement('div')
				row.className = 'test-row'
				row.textContent = item.name
				return row
			} })
		queue.set(Array.from({ length: 50000 }, (_, index) => ({ name: String(index) })))
		const firstCount = host.querySelectorAll('.test-row').length
		host.scrollTop = host.scrollHeight
		host.dispatchEvent(new Event('scroll'))
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		const last = host.querySelector('.test-row:last-child').textContent
		host.style.height = '560px'
		queue.refresh()
		await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		const resizedCount = host.querySelectorAll('.test-row').length
		queue.destroy(); host.remove()
		return { firstCount, last, resizedCount }
	})
	expect(result.firstCount).toBeLessThan(60)
	expect(result.last).toBe('49999')
	expect(result.resizedCount).toBeLessThan(70)
})

test('editor uses Monaco native localized context menu', async ({ modulePage, page }) => {
	await modulePage.run(async () => {
		const { createFileEditor } = await import('/parts/shells:code/src/fileEditor.mjs')
		const host = document.createElement('div')
		host.id = 'native-editor'
		host.style.cssText = 'height:280px;width:600px'
		document.body.append(host)
		const editor = await createFileEditor(host, {
			/** @returns {void} No changes required. */
			onChange() {},
			/** @returns {void} Record save menu activation. */
			onSave() { host.dataset.saved = 'yes' },
			/** @returns {void} No cursor display required. */
			onSelection() {},
		})
		await editor.show({ content: 'https://example.com', base: '' }, 'native.txt')
	})
	await page.locator('#native-editor .view-lines').click({ button: 'right' })
	await expect(page.getByRole('menuitem', { name: /保存/ })).toBeVisible()
	await expect(page.getByRole('menuitem', { name: /复制/ })).toBeVisible()
	await expect(page.locator('.code-editor-context-menu')).toHaveCount(0)
	await page.keyboard.press('ArrowDown')
	await expect(page.locator('.monaco-menu [role=menuitem]:focus')).toHaveCount(1)
	await page.getByRole('menuitem', { name: /保存/ }).click()
	await expect(page.locator('#native-editor')).toHaveAttribute('data-saved', 'yes')
})

test('Monaco preserves untouched mixed EOLs and serializes lone-CR edits', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { createFileEditor, bufferContent } = await import('/parts/shells:code/src/fileEditor.mjs')
		const host = document.createElement('div')
		host.style.cssText = 'height:280px;width:600px'
		document.body.append(host)
		const editor = await createFileEditor(host, {
			/** @returns {void} The serialization assertion does not inspect change callbacks. */
			onChange() {},
			/** @returns {void} The serialization assertion does not save through the shell. */
			onSave() {},
			/** @returns {void} The serialization assertion does not inspect the cursor. */
			onSelection() {},
		})
		const mixed = { content: 'first\r\nsecond\rthird\n', base: 'first\r\nsecond\rthird\n' }
		const lone = { content: 'first\rsecond\r', base: 'first\rsecond\r' }
		try {
			await editor.show(mixed, 'mixed-eol.txt')
			const untouched = bufferContent(mixed)
			editor.disposeBuffer(mixed)
			await editor.show(lone, 'lone-cr.txt')
			editor.view.executeEdits('test', [{ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 7 }, text: 'changed' }])
			return { untouched, edited: bufferContent(lone) }
		} finally {
			editor.disposeBuffer(mixed); editor.disposeBuffer(lone); editor.dispose(); host.remove()
		}
	})
	expect(result).toEqual({ untouched: 'first\r\nsecond\rthird\n', edited: 'first\rchanged\r' })
})


test('file editor renders a tab at the same width as four spaces', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { createFileEditor } = await import('/parts/shells:code/src/fileEditor.mjs')
		const host = document.createElement('div')
		host.style.cssText = 'height:280px;width:600px;--font-code:Consolas, monospace'
		document.body.append(host)
		const editor = await createFileEditor(host, {
			/** @returns {void} No change handling needed. */
			onChange() {},
			/** @returns {void} No saving needed. */
			onSave() {},
			/** @returns {void} No cursor reporting needed. */
			onSelection() {},
		})
		const buffer = { content: 'root:\n\ttab: 1\n    spaces: 2', base: '' }
		try {
			await editor.show(buffer, 'tabs.yaml')
			buffer.model.updateOptions({ tabSize: 8, indentSize: 8, insertSpaces: true })
			await editor.show(buffer, 'tabs.yaml')
			host.style.setProperty('--font-code', '"Courier New", monospace')
			document.fonts.dispatchEvent(new Event('loadingdone'))
			editor.view.render(true)
			return {
				letter: (() => {
					const range = document.createRange()
					const walker = document.createTreeWalker(host.querySelectorAll('.view-line')[1], NodeFilter.SHOW_TEXT)
					for (let text = walker.nextNode(); text; text = walker.nextNode()) {
						const index = text.textContent.indexOf('t')
						if (index < 0) continue
						range.setStart(text, index); range.setEnd(text, index + 1)
						return range.getBoundingClientRect().width
					}
					return null
				})(),
				fontFamily: editor.view.getRawOptions().fontFamily,
				options: buffer.model.getOptions(),
				tab: editor.view.getOffsetForColumn(2, 2),
				spaces: editor.view.getOffsetForColumn(3, 5),
				// Measure the actual glyph positions as well as Monaco's column offsets.
				dom: Array.from(host.querySelectorAll('.view-line')).slice(1, 3).map(line => {
					const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
					for (let node = walker.nextNode(); node; node = walker.nextNode()) {
						const index = node.textContent.search(/[a-z]/)
						if (index < 0) continue
						const range = document.createRange()
						range.setStart(node, index); range.setEnd(node, index + 1)
						return range.getBoundingClientRect().left - line.getBoundingClientRect().left
					}
					return null
				}),
			}
		} finally { editor.disposeBuffer(buffer); editor.dispose(); host.remove() }
	})
	expect(result.fontFamily).toBe('"Courier New", monospace')
	expect(result.options.tabSize).toBe(4)
	expect(result.tab).toBeCloseTo(result.spaces, 1)
	expect(result.options.insertSpaces).toBe(false)
	expect(result.dom).toHaveLength(2)
	expect(result.dom[0]).not.toBeNull()
	expect(result.dom[0]).toBeCloseTo(result.dom[1], 1)
	expect(result.dom[0] / result.letter).toBeCloseTo(4, 1)
})

test('user TextMate grammar and formatter integrate with Monaco and undo', async ({ modulePage }) => {
	const result = await modulePage.run(async () => {
		const { loadCodeRuntime, analyzeCode } = await import('/scripts/components/codeSyntax.mjs')
		const { installEditorExtensions, formatInWorker } = await import('/parts/shells:code/src/editorExtensions.mjs')
		const monaco = await loadCodeRuntime()
		const extensions = await installEditorExtensions(monaco, { languages: [{
			id: 'fountdemo', aliases: ['demo'], extensions: ['.demo'], configuration: {},
			grammar: { scopeName: 'source.fountdemo', patterns: [{ match: '\\bHELLO\\b', name: 'keyword.control.demo' }] },
			formatter: 'export async function format({ text, tabSize, insertSpaces, path }) { await new Promise(resolve => setTimeout(resolve, 50)); if (tabSize !== 4 || insertSpaces || !path.endsWith(".demo")) throw Error("Invalid options"); return text.trim().toUpperCase() }',
		}] })
		const host = document.createElement('div'); host.style.cssText = 'height:200px;width:500px'; document.body.append(host)
		const model = monaco.editor.createModel(' hello ', await extensions.languageFor('sample.demo'), monaco.Uri.parse('inmemory://test/sample.demo'))
		model.updateOptions({ tabSize: 4, insertSpaces: false })
		const view = monaco.editor.create(host, { model, occurrencesHighlight: 'off' })
		try {
			await view.getAction('editor.action.formatDocument').run()
			const formatted = model.getValue()
			view.trigger('test', 'undo', null)
			const undone = model.getValue()
			const originalPost = Worker.prototype.postMessage
			let started
			const workerStarted = new Promise(resolve => { started = resolve })
			/**
			 * @param {object} message - worker 请求。
			 * @param {...object} args - 转移选项。
			 * @returns {void} 在并发编辑前观测到格式化启动。
			 */
			Worker.prototype.postMessage = function(message, ...args) {
				originalPost.call(this, message, ...args)
				if (message.source) started()
			}
			try {
				const pending = view.getAction('editor.action.formatDocument').run()
				await workerStarted
				model.setValue('newer edit')
				await pending
			} finally { Worker.prototype.postMessage = originalPost }

			const afterConcurrentEdit = model.getValue()
			const highlight = await analyzeCode('HELLO plain', 'demo')
			let error
			try { await formatInWorker('export function format() { return 42 }', {}, { isCancellationRequested: false,
				/** @returns {object} No cancellation requested. */
				onCancellationRequested: () => ({
					/** @returns {void} Nothing to release. */
					dispose() {} }) }) }
			catch (failure) { error = failure.message }
			return { formatted, undone, afterConcurrentEdit, language: model.getLanguageId(), highlighted: highlight.tokens.some(token => token.style), error }
		} finally { view.dispose(); model.dispose(); extensions.dispose(); host.remove() }
	})
	expect(result.formatted).toBe('HELLO')
	expect(result.undone).toBe(' hello ')
	expect(result.afterConcurrentEdit).toBe('newer edit')
	expect(result.language).toBe('fountdemo')
	expect(result.highlighted).toBe(true)
	expect(result.error).toContain('must return text')
})


test('find controls and link hover follow the applied locale and switch without losing edits', async ({ modulePage, page }) => {
	await modulePage.run(async () => {
		const { initTranslations } = await import('/scripts/i18n/index.mjs')
		const { loadCodeRuntime } = await import('/scripts/components/codeSyntax.mjs')
		// Warm-up in English must not freeze labels after the real UI becomes Chinese.
		await initTranslations('code', ['en-UK'])
		await loadCodeRuntime()
		await initTranslations('code', ['zh-CN'])
		// A stale English preference must not override the active Chinese UI bundle.
		localStorage.setItem('userPreferredLanguages', JSON.stringify(['en-UK']))
		const { createFileEditor } = await import('/parts/shells:code/src/fileEditor.mjs')
		const host = document.createElement('div')
		host.id = 'locale-editor'
		host.style.cssText = 'height:280px;width:600px'
		document.body.append(host)
		const editor = await createFileEditor(host, {
			/** @returns {void} The test does not save changes. */
			onSave() {},
			/** @returns {void} Model edits are inspected directly. */
			onChange() {},
			/** @returns {void} No separate cursor UI. */
			onSelection() {},
		})
		const buffer = { content: 'https://example.com', base: 'https://example.com' }
		await editor.show(buffer, 'locale.txt')
		globalThis.__localeEditor = { editor, buffer, model: buffer.model }
		editor.focus()
	})
	await page.keyboard.press('Control+f')
	const find = page.locator('#locale-editor .find-widget .find-part textarea')
	await expect(find).toHaveAttribute('placeholder', '查找')
	await expect(page.locator('#locale-editor .find-widget .codicon-case-sensitive')).toHaveAttribute('aria-label', /区分大小写/)
	await page.keyboard.press('Control+h')
	await expect(page.locator('#locale-editor .replace-part textarea')).toHaveAttribute('placeholder', '替换')
	await page.keyboard.press('Escape')
	await page.locator('#locale-editor .detected-link').hover()
	await expect(page.locator('#locale-editor .monaco-hover:visible')).toContainText('打开链接')
	await page.mouse.move(650, 300)
	await modulePage.run(async () => {
		const { initTranslations } = await import('/scripts/i18n/index.mjs')
		const { editor } = globalThis.__localeEditor
		editor.view.setPosition({ lineNumber: 1, column: 20 })
		editor.view.trigger('test', 'type', { text: '/edited' })
		await initTranslations('code', ['en-UK'])
	})
	await page.locator('#locale-editor .monaco-editor').click()
	await page.keyboard.press('Control+f')
	await expect(find).toHaveAttribute('placeholder', 'Find')
	await expect(page.locator('#locale-editor .find-widget .codicon-case-sensitive')).toHaveAttribute('aria-label', /Match Case/)
	await expect(page.locator('#locale-editor .matchesCount')).toHaveText('1 of 1')
	await page.keyboard.press('Escape')
	await page.locator('#locale-editor .detected-link').hover()
	await expect(page.locator('#locale-editor .monaco-hover:visible')).toContainText('Follow link')
	await page.mouse.move(650, 300)
	await page.locator('#locale-editor .monaco-editor').click()
	await page.keyboard.press('Control+f')
	const search = await find.inputValue()
	await modulePage.run(async () => {
		const { initTranslations } = await import('/scripts/i18n/index.mjs')
		await initTranslations('code', ['zh-CN'])
	})
	await expect(find).toHaveAttribute('placeholder', '查找')
	await expect(find).toHaveValue(search)
	await expect(page.locator('#locale-editor .find-widget .codicon-case-sensitive')).toHaveAttribute('aria-label', /区分大小写/)
	await page.keyboard.press('Escape')
	const result = await modulePage.run(() => {
		const { editor, buffer, model } = globalThis.__localeEditor
		const sameModel = editor.view.getModel() === model
		editor.view.trigger('test', 'undo', null)
		const undone = model.getValue()
		editor.disposeBuffer(buffer); editor.dispose()
		return { sameModel, undone }
	})
	expect(result).toEqual({ sameModel: true, undone: 'https://example.com' })
})

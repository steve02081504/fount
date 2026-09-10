import { test, expect } from './fixtures.mjs'

const DANGEROUS_HTML = '<img src="data:image/gif;base64,AAAA" alt="p" onerror="globalThis.__fountPwned=1">'
const SECURE_PASTE_MARKER = 'secure paste payload'
const EDIT_URL = '/parts/shells:gist/edit.html'
const EDITOR_SELECTOR = '#markdown-editor'

/**
 * 在编辑器上挂载活动标记注入追踪：任何 on* 属性 / script / iframe / object / embed
 * 被插入编辑器 DOM（即使随后立即被重渲移除）都会递增 `__fountActiveInsertCount`；
 * `__fountPwned` 记录注入的 onerror 是否真的执行过。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>} 完成。
 */
async function installActiveInsertTracker(page) {
	await page.evaluate(editorSelector => {
		globalThis.__fountPwned = null
		globalThis.__fountActiveInsertCount = 0
		const editor = document.querySelector(editorSelector)
		new MutationObserver(records => {
			for (const record of records) {
				if (record.type === 'childList')
					for (const node of record.addedNodes) {
						if (node.nodeType !== Node.ELEMENT_NODE) continue
						const stack = [node]
						let active = false
						while (stack.length) {
							const element = stack.pop()
							if (element instanceof HTMLScriptElement
								|| element instanceof HTMLIFrameElement
								|| element instanceof HTMLObjectElement
								|| element instanceof HTMLEmbedElement) {
								active = true
								break
							}
							let hasHandler = false
							for (const attribute of element.attributes)
								if (attribute.name.toLowerCase().startsWith('on')) {
									hasHandler = true
									break
								}
							if (hasHandler) {
								active = true
								break
							}
							for (const child of element.children) stack.push(child)
						}
						if (active) globalThis.__fountActiveInsertCount++
					}
				if (record.type === 'attributes' && record.attributeName?.toLowerCase().startsWith('on'))
					globalThis.__fountActiveInsertCount++
			}
		}).observe(editor, { childList: true, subtree: true, attributes: true })
	}, EDITOR_SELECTOR)
}

/**
 * 把带 onerror 的 HTML 与纯文本占位一并写入系统剪贴板。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>} 完成。
 */
async function putDangerousHtmlOnClipboard(page) {
	await page.evaluate(({ html, marker }) => navigator.clipboard.write([new ClipboardItem({
		'text/html': new Blob([html], { type: 'text/html' }),
		'text/plain': new Blob([marker], { type: 'text/plain' }),
	})]), { html: DANGEROUS_HTML, marker: SECURE_PASTE_MARKER })
}

/**
 * 读取编辑器安全状态。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<{ pwned: unknown, activeInserts: number, liveHandlerElements: number }>} 安全状态
 */
async function readEditorSecurityState(page) {
	return page.evaluate(editorSelector => ({
		pwned: globalThis.__fountPwned,
		activeInserts: globalThis.__fountActiveInsertCount,
		liveHandlerElements: [...document.querySelectorAll(`${editorSelector} *`)].filter(element =>
			[...element.attributes].some(attribute => attribute.name.toLowerCase().startsWith('on'))).length,
	}), EDITOR_SELECTOR)
}

/**
 * 挂起 page watch 的 locale 轮换（避免打开的对话框文案在轮换扫描中触发 [test:locale]）。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>} 完成。
 */
async function holdLocale(page) {
	await page.waitForFunction(() => globalThis.fount?.test?.watch?.started === true, undefined, { timeout: 30_000 })
	await page.evaluate(() => globalThis.fount.test.watch.holdLocale())
}

/**
 * 恢复 page watch 的 locale 轮换。
 * @param {import('npm:@playwright/test').Page} page Playwright 页面
 * @returns {Promise<void>} 完成。
 */
async function releaseLocale(page) {
	await page.evaluate(() => globalThis.fount.test.watch.releaseLocale())
}

test.describe('gist edit paste security', () => {
	test('secure mode paste of script-bearing html never executes nor leaves active markup', async ({ page, baseUrl, context }) => {
		await page.goto(`${baseUrl}${EDIT_URL}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#title-input')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('input[name="securityLevel"][value="trusted"]')).toBeChecked({ timeout: 30_000 })
		await page.locator('input[name="securityLevel"][value="secure"]').check()
		await expect(page.locator('input[name="securityLevel"][value="secure"]')).toBeChecked()
		await installActiveInsertTracker(page)
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		const editor = page.locator(EDITOR_SELECTOR)
		await editor.click()
		await expect(editor).toBeFocused()
		await putDangerousHtmlOnClipboard(page)
		await page.keyboard.press('Control+V')
		await page.waitForTimeout(500)
		const state = await readEditorSecurityState(page)
		expect(state.pwned).toBeNull()
		expect(state.activeInserts).toBe(0)
		expect(state.liveHandlerElements).toBe(0)
	})

	test('declining the danger prompt keeps the payload inert and switches to secure', async ({ page, baseUrl, context }) => {
		await page.goto(`${baseUrl}${EDIT_URL}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#title-input')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('input[name="securityLevel"][value="trusted"]')).toBeChecked({ timeout: 30_000 })
		await installActiveInsertTracker(page)
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		const editor = page.locator(EDITOR_SELECTOR)
		await editor.click()
		await expect(editor).toBeFocused()
		await holdLocale(page)
		await putDangerousHtmlOnClipboard(page)
		await page.keyboard.press('Control+V')
		const dialog = page.locator('dialog[open]')
		await expect(dialog).toBeVisible({ timeout: 15_000 })
		await dialog.locator('[data-dialog-cancel]').click()
		await expect(page.locator('input[name="securityLevel"][value="secure"]')).toBeChecked({ timeout: 10_000 })
		await expect(editor).toContainText(SECURE_PASTE_MARKER)
		await releaseLocale(page)
		await page.waitForTimeout(500)
		const state = await readEditorSecurityState(page)
		expect(state.pwned).toBeNull()
		expect(state.activeInserts).toBe(0)
		expect(state.liveHandlerElements).toBe(0)
	})
})

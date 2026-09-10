/**
 * gist shell 前端 smoke：列表页加载、新建 → 查看完整链路、编辑页加载。
 */
import { test, expect } from './fixtures.mjs'

test.describe('gist shell smoke', () => {
	test('list page boots with empty state and new button', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('h1')).toHaveCount(1)
		await expect(page.locator('#new-gist-button')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#gist-list')).toBeVisible()
		await expect(page.locator('.gist-empty-state')).toBeVisible()
	})

	test('create a gist via edit page then view renders markdown', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:gist/edit.html`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#markdown-editor')).toBeVisible({ timeout: 30_000 })
		const editor = page.locator('#markdown-editor')
		await editor.click()
		await expect(editor).toBeFocused()
		await page.keyboard.type('# 标题一')
		await page.keyboard.press('Enter')
		await page.keyboard.press('Enter')
		await page.keyboard.type('正文内容 ')
		await page.keyboard.press('ControlOrMeta+b')
		await page.keyboard.type('加粗')
		await page.keyboard.press('ControlOrMeta+b')
		await page.locator('#save-button').click()
		await page.waitForURL(/view\/?\?id=/, { timeout: 30_000 })
		await expect(page.locator('#view-title')).toContainText('标题一')
		await expect(page.locator('#content h1')).toHaveText('标题一')
		await expect(page.locator('#content')).toContainText('加粗')
		await expect(page.locator('#security-toggle')).toHaveText('无防护')
	})

	test('masonry distributes cards into non-empty columns', async ({ page, baseUrl, apiKey }) => {
		const markdowns = []
		for (let index = 0; index < 7; index++) markdowns.push(`# 瀑布流测试 ${index}\n\n正文 ${index}`)
		for (const markdown of markdowns)
			await createGistApi(page.request, baseUrl, apiKey, markdown)
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('瀑布流测试')
		await expect(page.locator('.gist-card')).toHaveCount(7)
		const emptyColumns = await page.evaluate(() =>
			[...document.querySelectorAll('.gist-col')].filter(column => !column.querySelector('.gist-card')).length)
		expect(emptyColumns).toBe(0)
	})

	test('edit page loads an existing gist', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:gist/edit.html`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#markdown-editor')).toBeVisible({ timeout: 30_000 })
		const editor = page.locator('#markdown-editor')
		await editor.click()
		await expect(editor).toBeFocused()
		await page.keyboard.type('内容')
		await page.locator('#save-button').click()
		await page.waitForURL(/view\/?\?id=/, { timeout: 30_000 })
		await page.goto(`${baseUrl}/parts/shells:gist/edit.html${new URL(page.url()).search}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#markdown-editor')).toContainText('内容')
	})

	test('create with dedupe reuses the existing gist for identical markdown', async ({ page, baseUrl, apiKey }) => {
		const markdown = '# 去重测试\n\n相同内容只应存在一个 gist。'
		/**
		 * 以 dedupe 模式创建 gist。
		 * @returns {Promise<string>} 命中的 gist id。
		 */
		const create = async () => {
			const response = await page.request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
				headers: { 'fount-apikey': apiKey },
				data: { markdown, securityLevel: 'secure', dedupe: true },
			})
			expect(response.ok(), `create gist failed: ${response.status()}`).toBeTruthy()
			return (await response.json()).gist.id
		}
		const firstId = await create()
		const secondId = await create()
		expect(secondId).toBe(firstId)
	})

	/**
	 * 通过 API 创建 gist（标题由 markdown 推导，不再单独传 title）。
	 * @param {import('@playwright/test').APIRequestContext} request - Playwright 请求上下文。
	 * @param {string} baseUrl - 站点根地址。
	 * @param {string} apiKey - fount API key。
	 * @param {string} markdown - gist 正文。
	 * @returns {Promise<void>} 创建完成。
	 */
	const createGistApi = async (request, baseUrl, apiKey, markdown) => {
		const response = await request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
			headers: { 'fount-apikey': apiKey },
			data: { markdown, securityLevel: 'secure' },
		})
		expect(response.ok(), `create gist failed: ${response.status()}`).toBeTruthy()
	}

	test('list card shows title and opening excerpt without the title heading', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '# 摘要测试\n\n开头正文内容 ABC 结尾')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('摘要测试')
		await expect(page.locator('.gist-card')).toHaveCount(1)
		await expect(page.locator('.gist-card-cover-title')).toHaveText('摘要测试')
		await expect(page.locator('.gist-card-excerpt')).toHaveText('开头正文内容 ABC 结尾')
	})

	test('list card keeps a truncated fallback title in the excerpt', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '这段没有标题的正文会被截断成标题，摘要中仍应保留它。')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('这段没有标题')
		await expect(page.locator('.gist-card')).toHaveCount(1)
		await expect(page.locator('.gist-card-cover-title')).toContainText('这段没有标题')
		await expect(page.locator('.gist-card-excerpt')).toContainText('这段没有标题的正文')
	})

	test('english first word gets a lead accent span', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '# Acme widget guide\n\n开头正文')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('Acme widget guide')
		const title = page.locator('.gist-card-cover-title').first()
		await expect(title).toContainText('Acme widget guide')
		await expect(title.locator('.gist-card-cover-lead')).toHaveText('Acme')
	})

	test('selection UI appears on demand and Ctrl+A selects all visible', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '# 快捷键 A')
		await createGistApi(page.request, baseUrl, apiKey, '# 快捷键 B')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('快捷键')
		await expect(page.locator('.gist-card')).toHaveCount(2)
		await expect(page.locator('#gist-selection-bar')).toBeHidden()
		await expect(page.locator('.gist-select-checkbox').first()).toBeHidden()
		await page.locator('#select-mode-button').click()
		await expect(page.locator('#gist-selection-bar')).toBeVisible()
		await expect(page.locator('.gist-select-checkbox').first()).toBeVisible()
		await page.locator('h1').click()
		await page.keyboard.press('Control+a')
		await expect(page.locator('#selection-count')).toHaveText('已选择 2 个')
	})

	test('shift-click selects a continuous range', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '# 范围 A')
		await createGistApi(page.request, baseUrl, apiKey, '# 范围 B')
		await createGistApi(page.request, baseUrl, apiKey, '# 范围 C')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('范围')
		await expect(page.locator('.gist-card')).toHaveCount(3)
		await page.locator('.gist-card').first().click({ modifiers: ['ControlOrMeta'] })
		await page.locator('.gist-card').nth(2).click({ modifiers: ['Shift'] })
		await expect(page.locator('#selection-count')).toHaveText('已选择 3 个')
	})

	test('search filters and batch delete removes selected gists', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '# 批量测试 A')
		await createGistApi(page.request, baseUrl, apiKey, '# 批量测试 B')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#gist-sort-select')).toHaveValue('updated-desc')
		await page.locator('#gist-search-input').fill('批量测试')
		await expect(page.locator('.gist-card')).toHaveCount(2)
		await page.locator('#select-mode-button').click()
		await page.locator('#select-all-checkbox').check()
		await expect(page.locator('#selection-count')).toHaveText('已选择 2 个')
		await expect(page.locator('#batch-delete-button')).toBeEnabled()
		await page.locator('#batch-delete-button').click()
		await page.locator('dialog[open] [data-dialog-resolve="ok"]').click()
		await expect(page.locator('#gist-list .gist-empty-state')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#gist-list')).toContainText('没有匹配的 gist')
	})

	test('view assigns heading anchors and honors the URL hash', async ({ page, baseUrl, apiKey }) => {
		const filler = Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行填充内容。`).join('\n\n')
		const markdown = `# 锚点文档\n\n${filler}\n\n## 第一节\n\n${filler}\n\n## 第二节\n\n${filler}\n\n## 第三节\n\n${filler}`
		const response = await page.request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
			headers: { 'fount-apikey': apiKey },
			data: { markdown, securityLevel: 'secure' },
		})
		expect(response.ok(), `create gist failed: ${response.status()}`).toBeTruthy()
		const id = (await response.json()).gist.id
		const headings = page.locator('#content h2')
		const sectionIds = ['第一节', '第二节', '第三节']

		// 带 hash 打开：渲染完成后滚动到对应标题
		await page.goto(`${baseUrl}/parts/shells:gist/view/?id=${id}#${encodeURIComponent(sectionIds[1])}`, { waitUntil: 'domcontentloaded' })
		await expect(headings.nth(1)).toHaveAttribute('id', sectionIds[1], { timeout: 30_000 })
		await expect.poll(() => headings.nth(1).evaluate(el => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200)

		// 悬停标题后点击锚点链接更新 URL hash
		await headings.first().hover()
		await headings.first().locator('.gist-heading-anchor').click()
		await expect.poll(() => page.evaluate(() => decodeURIComponent(location.hash))).toBe(`#${sectionIds[0]}`)
	})
})

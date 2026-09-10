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
		await expect(page.locator('#title-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#title-input').fill('冒烟测试文档')
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
		await expect(page.locator('#view-title')).toContainText('冒烟测试文档')
		await expect(page.locator('#content h1')).toHaveText('标题一')
		await expect(page.locator('#content')).toContainText('加粗')
		await expect(page.locator('#security-toggle')).toHaveText('无防护')
	})

	test('edit page loads an existing gist', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:gist/edit.html`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#title-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#title-input').fill('既有文档')
		const editor = page.locator('#markdown-editor')
		await editor.click()
		await expect(editor).toBeFocused()
		await page.keyboard.type('内容')
		await page.locator('#save-button').click()
		await page.waitForURL(/view\/?\?id=/, { timeout: 30_000 })
		await page.goto(`${baseUrl}/parts/shells:gist/edit.html${new URL(page.url()).search}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#title-input')).toHaveValue('既有文档')
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
				data: { markdown, title: '去重测试', securityLevel: 'secure', dedupe: true },
			})
			expect(response.ok(), `create gist failed: ${response.status()}`).toBeTruthy()
			return (await response.json()).gist.id
		}
		const firstId = await create()
		const secondId = await create()
		expect(secondId).toBe(firstId)
	})

	/**
	 * 通过 API 创建指定标题的 gist。
	 * @param {import('@playwright/test').APIRequestContext} request - Playwright 请求上下文。
	 * @param {string} baseUrl - 站点根地址。
	 * @param {string} apiKey - fount API key。
	 * @param {string} title - gist 标题。
	 * @param {string} markdown - gist 正文。
	 * @returns {Promise<void>} 创建完成。
	 */
	const createGistApi = async (request, baseUrl, apiKey, title, markdown) => {
		const response = await request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
			headers: { 'fount-apikey': apiKey },
			data: { markdown, title, securityLevel: 'secure' },
		})
		expect(response.ok(), `create gist failed: ${response.status()}`).toBeTruthy()
	}

	test('list card shows title and opening excerpt', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '摘要测试', '# 摘要测试\n\n开头正文内容 ABC 结尾')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('摘要测试')
		await expect(page.locator('.gist-card')).toHaveCount(1)
		await expect(page.locator('.gist-card-title')).toHaveText('摘要测试')
		await expect(page.locator('.gist-card-excerpt')).toContainText('开头正文内容 ABC 结尾')
	})

	test('selection UI appears on demand and Ctrl+A selects all visible', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '快捷键 A', '# 快捷键 A')
		await createGistApi(page.request, baseUrl, apiKey, '快捷键 B', '# 快捷键 B')
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
		await createGistApi(page.request, baseUrl, apiKey, '范围 A', '# 范围 A')
		await createGistApi(page.request, baseUrl, apiKey, '范围 B', '# 范围 B')
		await createGistApi(page.request, baseUrl, apiKey, '范围 C', '# 范围 C')
		await page.goto(`${baseUrl}/parts/shells:gist/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#gist-search-input')).toBeVisible({ timeout: 30_000 })
		await page.locator('#gist-search-input').fill('范围')
		await expect(page.locator('.gist-card')).toHaveCount(3)
		await page.locator('.gist-card').first().click({ modifiers: ['ControlOrMeta'] })
		await page.locator('.gist-card').nth(2).click({ modifiers: ['Shift'] })
		await expect(page.locator('#selection-count')).toHaveText('已选择 3 个')
	})

	test('search filters and batch delete removes selected gists', async ({ page, baseUrl, apiKey }) => {
		await createGistApi(page.request, baseUrl, apiKey, '批量测试 A', '# 批量 A')
		await createGistApi(page.request, baseUrl, apiKey, '批量测试 B', '# 批量 B')
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
})

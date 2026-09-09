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
		const url = page.url()
		await page.goto(`${baseUrl}/parts/shells:gist/edit.html${url.slice(url.indexOf('?'))}`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#title-input')).toHaveValue('既有文档')
		await expect(page.locator('#markdown-editor')).toContainText('内容')
	})
})

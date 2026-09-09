/**
 * Home shell 前端 smoke：页面可加载、核心控件可见。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Home shell smoke', () => {
	test('home page boots with filter and part list', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:home/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#filter-input')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('main')).toBeVisible()
		const pageTitle = page.locator('#page-title')
		await expect(pageTitle).toBeVisible()
		await expect(pageTitle).not.toHaveText('', { timeout: 30_000 })
		await expect(page.locator('#part-types-containers > .part-items-grid:not(.hidden)').first()).toBeVisible({
			timeout: 30_000,
		})
		await expect(page.locator('#function-buttons-container')).toBeAttached()
	})

	test('dropping a markdown file creates a gist and navigates to its view page', async ({ page, baseUrl }) => {
		const errors = []
		page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
		await page.goto(`${baseUrl}/parts/shells:home/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#filter-input')).toBeVisible({ timeout: 30_000 })
		await page.waitForFunction(() => {
			const list = document.querySelector('#function-buttons-container')
			return list && list.childElementCount > 0
		}, null, { timeout: 20_000 })
		await page.evaluate(() => {
			const md = new File(['# 拖放标题\n\n正文'], 'note.md', { type: 'text/markdown' })
			const dt = new DataTransfer()
			dt.items.add(md)
			document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
		})
		try {
			await page.waitForURL(/parts\/shells:gist\/view\/?\?id=/, { timeout: 20_000 })
		}
		catch {
			throw new Error(`md drop did not navigate. page errors:\n${errors.join('\n') || '(none)'}`)
		}
		await expect(page.locator('#view-title')).toContainText('note')
		await expect(page.locator('#content h1')).toHaveText('拖放标题')
	})
})

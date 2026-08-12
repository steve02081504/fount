/**
 * BrowserIntegration shell 前端 smoke：页面可加载、脚本 URL 与 autorun 列表就绪。
 */
import { test, expect } from './fixtures.mjs'

test.describe('BrowserIntegration shell smoke', () => {
	test('browser integration page boots with script URL and autorun list', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:browserIntegration/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#script-url-input')).toBeVisible()
		await expect(page.locator('#script-url-input')).not.toHaveValue('')
		await expect(page.locator('#copy-script-url-button')).toBeVisible()
		await expect(page.locator('#autorun-script-form')).toBeVisible()
		const autorunList = page.locator('#autorun-script-list')
		await expect(autorunList).toBeVisible()
		await expect(autorunList.locator(':scope > *').first()).toBeVisible({ timeout: 30_000 })
	})
})

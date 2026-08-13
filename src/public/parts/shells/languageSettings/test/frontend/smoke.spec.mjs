/**
 * LanguageSettings shell 前端 smoke：页面可加载、语言控件可见；必要时走 preferred 模板。
 */
import { test, expect } from './fixtures.mjs'

test.describe('LanguageSettings shell smoke', () => {
	test('language settings page boots with save controls', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:languageSettings/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#saveButton')).toBeVisible()
		await expect(page.locator('#resetButton')).toBeVisible()
		await expect(page.locator('#availableLanguagesDropdown')).toBeVisible()
		const preferred = page.locator('#preferredLanguagesList')
		await expect(preferred).toBeVisible()
		await expect(preferred.locator(':scope > *').first()).toBeVisible({ timeout: 30_000 })
	})
})

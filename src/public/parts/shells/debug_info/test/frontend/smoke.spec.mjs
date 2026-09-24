/**
 * debug_info shell 前端 smoke：页面可加载、系统信息表渲染。
 */
import { test, expect } from './fixtures.mjs'

test.describe('debug_info shell smoke', () => {
	test('debug info page boots with system table', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('main')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#copy-button')).toBeVisible()
		await expect(page.locator('h1[data-i18n="debug_info.heading"]')).toBeVisible()
		const systemTable = page.locator('#system-info-table')
		await expect(systemTable).toBeVisible()
		await expect(systemTable.locator('tr').first()).toBeVisible({ timeout: 30_000 })
	})

	test('update button surfaces the auto-update-disabled notice instead of staying silently disabled', async ({ page, baseUrl }) => {
		// 云端 SHA 与本地不同，保证版本检查进入「有更新」状态，更新按钮可用。
		await page.route('https://api.github.com/**', route => route.fulfill({ json: { sha: '0'.repeat(40) } }))
		// 自动更新关闭（.noupdate / Docker 镜像）时后端拒绝重启，前端应给出明确提示而非静默失败。
		await page.route('**/api/parts/shells:debug_info/restart', route => route.fulfill({ status: 403, json: { error: 'auto_update_disabled' } }))

		await page.goto(`${baseUrl}/parts/shells:debug_info/`, { waitUntil: 'domcontentloaded' })

		const updateButton = page.locator('#update-button')
		await expect(updateButton).toBeEnabled({ timeout: 30_000 })
		await updateButton.click()
		await expect(page.locator('#toast-container .alert-warning div[data-i18n="debug_info.autoUpdateNotEnabled"]')).toBeVisible()
		await expect(updateButton).toBeEnabled()
	})
})

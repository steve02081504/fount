/**
 * code shell 前端 UI 测试：电源操作设置。
 */
import { test, expect } from './fixtures.mjs'
import { API_BASE, holdLocale, openCode, releaseLocale } from './helpers.mjs'

test.describe('code shell power actions', () => {
	test('settings dialog configures per-host power action', async ({ page, baseUrl }) => {
		await openCode(page, baseUrl)
		await holdLocale(page)
		try {
			const button = page.locator('#power-settings-button')
			const badge = page.locator('#power-armed-badge')
			// 图标按钮：无内联文本，默认无武装角标
			await expect(button).toBeVisible()
			await expect(badge).toBeHidden()
			await button.click()
			const dialog = page.locator('dialog.modal', { has: page.locator('#power-settings-list') })
			await expect(dialog).toBeVisible()
			// 无 subfount 时仅有本机可选，四个操作项（不操作/关机/休眠/重启）
			await expect(dialog.locator('select[data-machine-id]')).toHaveCount(1)
			const select = dialog.locator('select[data-machine-id="0"]')
			await expect(select).toBeVisible()
			await expect(select.locator('option')).toHaveCount(4)
			// 选择关机 → 图标按钮武装：角标计数 + 警示配色
			await select.selectOption('shutdown')
			await expect(badge).toBeVisible()
			await expect(badge).toHaveText('1')
			await expect(button).toHaveClass(/btn-warning/)
			await expect(async () => {
				const data = await (await page.request.get(`${baseUrl}${API_BASE}/shutdown`)).json()
				expect(data.actions).toEqual({ 0: 'shutdown' })
			}).toPass()
			// 改为休眠
			await select.selectOption('sleep')
			await expect(async () => {
				const data = await (await page.request.get(`${baseUrl}${API_BASE}/shutdown`)).json()
				expect(data.actions).toEqual({ 0: 'sleep' })
			}).toPass()
			// 恢复不操作 → 角标消失、配色回到 ghost
			await select.selectOption('')
			await expect(badge).toBeHidden()
			await expect(button).not.toHaveClass(/btn-warning/)
			await expect(async () => {
				const data = await (await page.request.get(`${baseUrl}${API_BASE}/shutdown`)).json()
				expect(data.actions).toEqual({})
			}).toPass()
		}
		finally {
			await releaseLocale(page)
		}
	})
})

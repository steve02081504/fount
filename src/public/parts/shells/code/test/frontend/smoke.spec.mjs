/**
 * code shell 页面冒烟：加载、下拉与 composer 挂载。
 */
import { test, expect } from './fixtures.mjs'

test.describe('code shell smoke', () => {
	test('page boots with builtin modes and composer', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:code/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('h1')).toHaveCount(1)
		await expect(page.locator('#mode-select option')).toContainText(['plan'])
		await expect(page.locator('#mode-select option')).toContainText(['build'])
		await expect(page.locator('#machine-select option').first()).toContainText('本机')
		await expect(page.locator('#send-button')).toHaveText('发送')
		await expect(page.locator('#ai-source-select option').first()).toHaveText('角色自带')
	})

	test('typing ！ switches to shell mode', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:code/`, { waitUntil: 'domcontentloaded' })
		await expect(page.locator('#send-button')).toHaveText('发送')
		const composer = page.locator('#composer-input')
		await composer.click()
		await page.keyboard.type('！')
		await expect(page.locator('#shell-mode-control')).toBeVisible()
		await page.keyboard.press('Backspace')
		await expect(page.locator('#shell-mode-control')).toBeHidden()
	})
})

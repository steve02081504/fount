/**
 * Telegram bot URL `char` 参数模板预填回归。
 * 回归对象：`?name=X&char=Y` 下新建 bot 应预填角色配置模板，而非留 `{}`。
 */
import { test, expect } from './fixtures.mjs'

test.describe('Telegram bot URL char template prefill', () => {
	test('URL char param pre-fills a fresh bot with the char config template', async ({ page, baseUrl }) => {
		const botname = `url-char-fresh-${Date.now()}`
		await page.goto(`${baseUrl}/parts/shells:telegrambot/?name=${botname}&char=urlChar`, {
			waitUntil: 'domcontentloaded',
		})
		const content = page.locator('#config-editor .cm-content')
		await expect(content).toBeVisible({ timeout: 30_000 })
		await expect(content).toContainText('URL_CHAR_TEMPLATE_OWNER')
	})

	test('URL char param does not clobber a saved non-empty config', async ({ page, baseUrl }) => {
		const botname = `url-char-saved-${Date.now()}`
		const saved = { token: 'test-token', char: 'urlChar', config: { OwnerUserID: 'SAVED_OWNER' } }
		const res = await page.request.post(`${baseUrl}/api/parts/shells:telegrambot/setbotconfig`, {
			data: { botname, config: saved },
		})
		expect(res.ok()).toBeTruthy()

		await page.goto(`${baseUrl}/parts/shells:telegrambot/?name=${botname}&char=urlChar`, {
			waitUntil: 'domcontentloaded',
		})
		const content = page.locator('#config-editor .cm-content')
		await expect(content).toBeVisible({ timeout: 30_000 })
		await expect(content).toContainText('SAVED_OWNER')
		await expect(content).not.toContainText('URL_CHAR_TEMPLATE_OWNER')
	})
})

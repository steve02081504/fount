/**
 * Telegram bot JSON 编辑器 aria-label 与 Ctrl+S 保存。
 */
import {
	expectJsonEditorAriaLabel,
	expectJsonEditorCtrlSSave,
} from 'fount/scripts/test/playwright/json_editor.mjs'

import { test, expect } from './fixtures.mjs'

test.describe('Telegram bot JSON editor a11y', () => {
	test('config editor mounts with i18n aria-label', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:telegrambot/?name=aria-json-editor`, {
			waitUntil: 'domcontentloaded',
		})
		await expectJsonEditorAriaLabel(
			page,
			'#config-editor',
			'telegram_bots.configCard.jsonEditor.aria-label',
			expect,
		)
	})
})

test.describe('Telegram bot JSON editor Ctrl+S save', () => {
	test('Ctrl+S is intercepted and saves the bot config', async ({ page, baseUrl }) => {
		const botName = 'ctrl-s-save'
		await page.goto(`${baseUrl}/parts/shells:telegrambot/?name=${botName}`, {
			waitUntil: 'domcontentloaded',
		})

		const content = page.locator('#config-editor .cm-content')
		await expect(content).toBeVisible({ timeout: 30_000 })

		// 编辑 token 与角色配置 JSON
		await page.locator('#token-input').fill('test-token')
		await content.focus()
		await page.keyboard.press('Control+a')
		await page.keyboard.type('{"foo":"bar"}')

		// Ctrl+S 必须被容器监听拦截（vanilla-jsoneditor 会 stopPropagation 冒泡），
		// 且触发 onSave → 配置持久化。
		await expectJsonEditorCtrlSSave(page, '#config-editor', expect)

		await expect.poll(() => page.evaluate(async botName => {
			const { getBotConfig } = await import('/parts/shells:telegrambot/src/endpoints.mjs')
			return getBotConfig(botName)
		}, botName)).toMatchObject({
			token: 'test-token',
			config: { foo: 'bar' },
		})
	})
})
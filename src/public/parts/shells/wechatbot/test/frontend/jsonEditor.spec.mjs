/**
 * WeChat bot JSON 编辑器 aria-label。
 */
import { expectJsonEditorAriaLabel } from 'fount/scripts/test/playwright/json_editor.mjs'

import { test, expect } from './fixtures.mjs'

test.describe('WeChat bot JSON editor a11y', () => {
	test('config editor mounts with i18n aria-label', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:wechatbot/?name=aria-json-editor`, {
			waitUntil: 'domcontentloaded',
		})
		await expectJsonEditorAriaLabel(
			page,
			'#config-editor',
			'wechat_bots.configCard.jsonEditor.aria-label',
			expect,
		)
	})
})

/**
 * Config shell JSON 编辑器 aria-label。
 */
import { expectJsonEditorAriaLabel } from 'fount/scripts/test/playwright/json_editor.mjs'

import { test, expect } from './fixtures.mjs'

test.describe('Config JSON editor a11y', () => {
	test('editor mounts with i18n aria-label when partpath is set', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:config/?partpath=shells/config`, {
			waitUntil: 'domcontentloaded',
		})
		await expectJsonEditorAriaLabel(
			page,
			'#jsonEditor',
			'part_config.editor.jsonEditor.aria-label',
			expect,
		)
	})
})

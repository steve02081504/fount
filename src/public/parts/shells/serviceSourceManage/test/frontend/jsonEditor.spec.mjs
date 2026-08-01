/**
 * Service source manager JSON 编辑器 aria-label。
 */
import { expectJsonEditorAriaLabel } from 'fount/scripts/test/playwright/json_editor.mjs'

import { test, expect } from './fixtures.mjs'

test.describe('Service source manager JSON editor a11y', () => {
	test('editor mounts with i18n aria-label on page load', async ({ page, baseUrl }) => {
		await page.goto(`${baseUrl}/parts/shells:serviceSourceManage/`, {
			waitUntil: 'domcontentloaded',
		})
		await expectJsonEditorAriaLabel(
			page,
			'#jsonEditor',
			'serviceSource_manager.jsonEditor.aria-label',
			expect,
		)
	})
})

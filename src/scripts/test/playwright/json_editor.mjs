/**
 * 断言 JSON 编辑器（vanilla-jsoneditor text mode）的 aria-label 与 i18n 一致。
 * 会暂挂 `fount.test.localeHold`，避免语言轮换与断言竞态。
 * @param {import('@playwright/test').Page} page 页面
 * @param {string} containerSelector 编辑器容器选择器
 * @param {string} i18nKey aria-label 的 i18n key
 * @param {import('@playwright/test').Expect} expect Playwright expect
 * @returns {Promise<void>}
 */
export async function expectJsonEditorAriaLabel(page, containerSelector, i18nKey, expect) {
	await page.evaluate(() => {
		globalThis.fount.test.localeHold = (globalThis.fount.test.localeHold || 0) + 1
	})
	try {
		const content = page.locator(`${containerSelector} .cm-content`)
		await expect(content).toBeVisible({ timeout: 30_000 })

		const expected = await page.evaluate(async key => {
			const { geti18n } = await import('/scripts/i18n/index.mjs')
			return geti18n(key)
		}, i18nKey)
		expect(expected, `i18n key resolves: ${i18nKey}`).not.toBe(i18nKey)
		await expect(content).toHaveAttribute('aria-label', expected)
	}
	finally {
		await page.evaluate(() => {
			globalThis.fount.test.localeHold = Math.max(0, (globalThis.fount.test.localeHold || 1) - 1)
		})
	}
}

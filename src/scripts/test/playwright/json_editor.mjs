/**
 * 断言 JSON 编辑器（vanilla-jsoneditor text mode）的 aria-label 与 i18n 一致。
 * 会暂挂 `watch.holdLocale()`，避免语言轮换与断言竞态。
 * @param {import('@playwright/test').Page} page 页面
 * @param {string} containerSelector 编辑器容器选择器
 * @param {string} i18nKey aria-label 的 i18n key
 * @param {import('@playwright/test').Expect} expect Playwright expect
 * @returns {Promise<void>}
 */
export async function expectJsonEditorAriaLabel(page, containerSelector, i18nKey, expect) {
	await page.evaluate(() => globalThis.fount?.test?.watch?.holdLocale?.())
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
		await page.evaluate(() => globalThis.fount?.test?.watch?.releaseLocale?.())
	}
}

/**
 * 断言编辑器内按 Ctrl+S 会被容器的 keydown 监听拦截并 preventDefault。
 * vanilla-jsoneditor 在 `.jse-main` 上对所有 keydown 调用 `stopPropagation()`，
 * 冒泡阶段的容器监听永远收不到事件 → 浏览器保存网页弹窗接管。产品必须用捕获阶段监听。
 * 在容器上派发合成 keydown（捕获阶段探针监听先注册于产品监听之后，同元素同阶段按注册顺序触发），
 * 因此 `defaultPrevented === true` 即证明产品的 Ctrl+S 拦截生效。
 * @param {import('@playwright/test').Page} page 页面
 * @param {string} containerSelector 编辑器容器选择器
 * @param {import('@playwright/test').Expect} expect Playwright expect
 * @returns {Promise<void>}
 */
export async function expectJsonEditorCtrlSSave(page, containerSelector, expect) {
	const content = page.locator(`${containerSelector} .cm-content`)
	await expect(content).toBeVisible({ timeout: 30_000 })

	const prevented = await page.evaluate(containerSelector => {
		const container = document.querySelector(containerSelector)
		let prevented = false
		container.addEventListener('keydown', e => {
			if (e.ctrlKey && e.key === 's') prevented = e.defaultPrevented
		}, true)
		container.querySelector('.cm-content').dispatchEvent(
			new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
		)
		return prevented
	}, containerSelector)

	expect(prevented).toBe(true)
}

/**
 * `expectJsonEditorAriaLabel` 的取 hold 顺序回归：page-watch 是异步挂载的，
 * 真实 shell 页面上 helper 可能比 `fount.test.watch.holdLocale` 先跑到，直接调用会 TypeError；
 * helper 必须先等 API 出现，再取 hold。
 */
import { expectJsonEditorAriaLabel } from 'fount/scripts/test/playwright/json_editor.mjs'

import { expect, test } from './fixtures.mjs'

/**
 * 包装页面的 waitForFunction：首次调用时挂上 page-watch API，
 * 复现「helper 先跑、watch 后到」的窗口。
 * @param {import('npm:@playwright/test').Page} page 页面
 * @returns {(...args: unknown[]) => Promise<unknown>} 包装后的等待函数
 */
function watchMountedOnFirstWait(page) {
	const waitForFunction = page.waitForFunction.bind(page)
	return async (...args) => {
		await page.evaluate(() => {
			/** @returns {Promise<void>} */
			globalThis.fount.test.watch.holdLocale = async () => {
				globalThis.__jsonEditorHold = (globalThis.__jsonEditorHold ?? 0) + 1
				globalThis.__jsonEditorHeld = true
			}
		})
		return await waitForFunction(...args)
	}
}

test('waits for the page-watch locale API before holding it', async ({ modulePage }) => {
	await modulePage.run(async () => {
		const { geti18n } = await import('/scripts/i18n/index.mjs')
		const editor = document.createElement('div')
		editor.className = 'editor'
		editor.innerHTML = '<div class="cm-content" style="min-height: 24px">{}</div>'
		editor.querySelector('.cm-content').setAttribute('aria-label', geti18n('util.pow_captcha.initial'))
		document.body.append(editor)
		// modulePage 不跑 page-watch（`watch.disabled`），这里模拟它尚未挂上 API 的窗口。
		globalThis.fount.test.watch = {
			/** 未取 hold 就释放即失败。
			 * @returns {void}
			 */
			releaseLocale() {
				if (!globalThis.__jsonEditorHold) throw new Error('released before hold')
				globalThis.__jsonEditorHold--
			},
		}
	})

	const page = modulePage.page
	const originalWaitForFunction = page.waitForFunction
	page.waitForFunction = watchMountedOnFirstWait(page)
	try {
		await expectJsonEditorAriaLabel(page, '.editor', 'util.pow_captcha.initial', expect)
	}
	finally { page.waitForFunction = originalWaitForFunction }

	await expect.poll(() => modulePage.run(() => ({
		held: globalThis.__jsonEditorHeld,
		outstandingHolds: globalThis.__jsonEditorHold,
	}))).toEqual({ held: true, outstandingHolds: 0 })
})

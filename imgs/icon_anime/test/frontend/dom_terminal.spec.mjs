/**
 * 图标动画在网页 DOM 终端中接受传入 console，渲染 / 播放 / 停止后主缓冲不变。
 */
import { requireTestBaseUrl } from 'fount/scripts/test/playwright/env.mjs'

import { expect, test } from './fixtures.mjs'

const MARKER = 'HELLO_FOUNT_ICON'

test.describe('icon_anime DOM terminal', () => {
	test('demo page plays in the terminal', async ({ page }) => {
		await page.goto(`${requireTestBaseUrl()}/imgs/icon_anime/`, { waitUntil: 'domcontentloaded' })
		await page.waitForSelector('.xterm')
		await page.waitForFunction(() => {
			const rows = document.querySelector('.xterm-rows')
			return Boolean(rows?.innerText?.trim())
		}, null, { timeout: 15_000 })
	})

	test('accepts setIO(terminal), plays, and restores buffer on stop', async ({ page }) => {
		await page.goto(`${requireTestBaseUrl()}/imgs/icon_anime/test/frontend/harness.html`, { waitUntil: 'domcontentloaded' })
		const { before, afterStop, later } = await page.evaluate(async marker => {
			const { playAndRestore } = await import('./dom_terminal.mjs')
			return playAndRestore(marker)
		}, MARKER)
		expect(before).toContain(MARKER)
		expect(afterStop).toContain(MARKER)
		expect(later).toBe(afterStop)
	})
})

/**
 * 图标动画演示页：DOM 终端播放，停止后主缓冲不变。
 */
import { requireTestBaseUrl } from 'fount/scripts/test/playwright/env.mjs'

import { expect, test } from './fixtures.mjs'

const MARKER = 'HELLO_FOUNT_ICON'

/**
 * 打开演示页并等到 `globalThis.terminal` / `icon` 就绪。
 * @param {import('npm:@playwright/test').Page} page 页
 * @returns {Promise<void>}
 */
const openDemo = async page => {
	await page.goto(`${requireTestBaseUrl()}/imgs/icon_anime/`, { waitUntil: 'domcontentloaded' })
	await page.waitForFunction(() => globalThis.terminal && globalThis.icon)
}

/**
 * 写入标记 → 播放 → dismiss，返回主缓冲快照。
 * 在演示页里跑：页面已 `start()`，先 dismiss 再写标记。
 * @param {string} marker 主缓冲标记
 * @returns {Promise<{ before: string, afterStop: string, later: string }>} 快照
 */
async function playAndRestore(marker) {
	const { terminal, icon } = globalThis
	/**
	 * @param {{ length: number, getLine: (lineIndex: number) => { translateToString: (trim: boolean) => string } }} buffer xterm 缓冲
	 * @returns {string} 纯文本
	 */
	const bufferText = buffer => {
		const lines = []
		for (let lineIndex = 0; lineIndex < buffer.length; lineIndex++)
			lines.push(buffer.getLine(lineIndex).translateToString(true))
		return lines.join('\n')
	}
	/**
	 * @param {number} ms 毫秒
	 * @returns {Promise<void>}
	 */
	const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
	/**
	 * @param {() => boolean} ready 条件
	 * @param {number} timeout 毫秒
	 * @returns {Promise<void>}
	 */
	const until = async (ready, timeout) => {
		for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(50))
			if (ready()) return
		throw new Error('timeout')
	}

	await until(() => terminal.buffer.active.type === 'alternate' && bufferText(terminal.buffer.active).trim(), 15_000)
	await icon.dismiss()
	await until(() => terminal.buffer.active.type === 'normal', 10_000)
	await new Promise(resolve => terminal.write(marker, resolve))
	const before = bufferText(terminal.buffer.normal)
	void icon.start()
	await until(() => terminal.buffer.active.type === 'alternate' && bufferText(terminal.buffer.active).trim(), 15_000)
	await icon.dismiss()
	await until(() => terminal.buffer.active.type === 'normal', 10_000)
	const afterStop = bufferText(terminal.buffer.normal)
	await sleep(400)
	return { before, afterStop, later: bufferText(terminal.buffer.normal) }
}

test.describe('icon_anime DOM terminal', () => {
	test('demo page plays in the terminal', async ({ page }) => {
		await openDemo(page)
		await page.waitForFunction(() => {
			const rows = document.querySelector('.xterm-rows')
			return Boolean(rows?.innerText?.trim())
		}, null, { timeout: 15_000 })
	})

	test('accepts setIO(terminal), plays, and restores buffer on stop', async ({ page }) => {
		await openDemo(page)
		const { before, afterStop, later } = await page.evaluate(playAndRestore, MARKER)
		expect(before).toContain(MARKER)
		expect(afterStop).toContain(MARKER)
		expect(later).toBe(afterStop)
	})
})

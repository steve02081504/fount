/**
 * 调试版 drop 用例：记录 fetch 时间线
 */
import { test, expect } from './fixtures.mjs'

test('drop timeline', async ({ page, baseUrl }) => {
	const logs = []
	page.on('request', r => logs.push([Date.now(), 'req', r.url().slice(-70)]))
	page.on('response', r => logs.push([Date.now(), 'res', r.status(), r.url().slice(-70)]))
	await page.goto(`${baseUrl}/parts/shells:home/`, { waitUntil: 'domcontentloaded' })
	const bootTimes = await page.evaluate(async () => {
		const t = []
		await pageOriginInit()
		async function pageOriginInit() { /* no-op */ }
		return t
	}).catch(() => null)
	const ok = await page.waitForFunction(() => {
		const list = document.querySelector('#function-buttons-container')
		return list && list.childElementCount > 0
	}, null, { timeout: 20_000 }).then(() => true).catch(() => false)
	await page.evaluate(() => {
		const dataTransfer = new DataTransfer()
		dataTransfer.items.add(new File(['# 拖放标题\n\n正文'], 'note.md', { type: 'text/markdown' }))
		dataTransfer.setData('text/plain', 'C:\\Users\\test\\Desktop\\note.md')
		document.body.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }))
	})
	await page.waitForTimeout(6000)
	throw new Error('TIMELINE ' + JSON.stringify({ bootTimes, ok, url: page.url(), logs: logs.slice(-30) }, null, 1))
})

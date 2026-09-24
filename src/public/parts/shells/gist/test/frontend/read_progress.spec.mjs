/**
 * gist 文档查看页阅读进度：按内容块锚点恢复到同一段内容（窗口尺寸变化后同样成立，
 * 锚点采集 / 换算由 scrollProgress 模块页测试覆盖）。
 */
import { expect, test } from './fixtures.mjs'

/**
 * 通过 API 创建 gist 并返回 id。
 * @param {import('@playwright/test').APIRequestContext} request - Playwright 请求上下文。
 * @param {string} baseUrl - 站点根地址。
 * @param {string} apiKey - fount API key。
 * @param {string} markdown - gist 正文。
 * @returns {Promise<string>} gist id。
 */
async function createGist(request, baseUrl, apiKey, markdown) {
	const response = await request.post(`${baseUrl}/api/parts/shells:gist/gists`, {
		headers: { 'fount-apikey': apiKey },
		data: { markdown, securityLevel: 'secure' },
	})
	expect(response.ok(), `create gist failed: ${response.status()}`).toBeTruthy()
	return (await response.json()).gist.id
}

test('restores gist reading progress from a saved block anchor', async ({ page, baseUrl, apiKey }) => {
	await page.addInitScript(() => { history.scrollRestoration = 'manual' })
	const body = Array.from({ length: 60 }, (_, index) => `阅读进度第 ${index + 1} 行，用于撑高文档。`).join('\n\n')
	const id = await createGist(page.request, baseUrl, apiKey, `# 阅读进度测试\n\n${body}`)

	// 直接种入指向第 40 段的锚点（h1 为 block 0，故第 40 段为 block 40）
	const seeded = await page.request.post(`${baseUrl}/api/parts/shells:gist/read-progress`, {
		headers: { 'fount-apikey': apiKey },
		data: { progress: [{ id, anchor: { blockIndex: 40, blockSig: '', offsetRatio: 0 }, ratio: 0 }] },
	})
	expect(seeded.ok(), `seed progress failed: ${seeded.status()}`).toBeTruthy()

	await page.goto(`${baseUrl}/parts/shells:gist/view/?id=${id}`, { waitUntil: 'domcontentloaded' })
	const paragraphs = page.locator('#content > p')
	await expect(paragraphs.nth(39)).toBeVisible({ timeout: 30_000 })
	const scroller = page.locator('#gist-scroll')

	// 恢复后内部滚动容器应滚到第 40 段附近
	await expect.poll(() => scroller.evaluate(element => element.scrollTop), { timeout: 30_000 }).toBeGreaterThan(400)
	const firstParagraphTop = await scroller.evaluate(element => {
		const targets = [...element.querySelectorAll('#content > p')]
		return targets.length ? Math.round(targets[39].getBoundingClientRect().top - element.getBoundingClientRect().top) : -1
	})
	expect(Math.abs(firstParagraphTop)).toBeLessThan(160)

	// 关闭重开仍回到同一位置
	await page.goto('about:blank')
	await page.goto(`${baseUrl}/parts/shells:gist/view/?id=${id}`, { waitUntil: 'domcontentloaded' })
	await expect(paragraphs.nth(39)).toBeVisible({ timeout: 30_000 })
	await expect.poll(() => scroller.evaluate(element => element.scrollTop), { timeout: 30_000 }).toBeGreaterThan(400)
})

/**
 * 存储型 XSS 复现：消息正文 `![](https://evil.test/poc.svg)` 中的远程 `.svg` 若被
 * svgInliner 内联会激活其中 `<script>`（「看见就中招」）。markdown 渲染管线必须给
 * 用户内容的 `<img>` 标记 `svg-inliner-ignore`，保持 `<img>` 而非内联执行。
 */
import {
	test,
	expect,
	openFreshGroupChannel,
	sendMessageViaComposer,
} from './fixtures.mjs'

/** 恶意 SVG：内联后设置全局标记即证明脚本执行。 */
const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svgPwned = true</script></svg>'

test.describe('chat message svg injection', () => {
	test.describe.configure({ timeout: 600_000 })

	test('remote .svg in message markdown is not inlined', async ({ page, baseUrl, apiKey }) => {
		await page.route('https://evil.test/**', async route => {
			await route.fulfill({
				status: 200,
				headers: {
					'Content-Type': 'image/svg+xml',
					'Access-Control-Allow-Origin': '*',
					'Cache-Control': 'no-store',
				},
				body: EVIL_SVG,
			})
		})

		const { groupId, channelId } = await openFreshGroupChannel(page, baseUrl, apiKey)
		await sendMessageViaComposer(page, groupId, channelId, '![](https://evil.test/poc.svg)')
		const img = page.locator('#messages img[src="https://evil.test/poc.svg"]')
		await expect(img).toHaveCount(1, { timeout: 60_000 })

		// 给 template/theme 的 svgInliner 机会执行（内联 fetch + 脚本）
		await page.waitForTimeout(2000)
		expect(await page.evaluate(() => window.__svgPwned === true)).toBe(false)

		// 图片应保持 `<img>`（未被替换为内联 `<svg>`）
		await expect(img).toHaveCount(1)
	})
})
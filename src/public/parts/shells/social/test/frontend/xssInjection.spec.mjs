/**
 * 存储型 XSS 复现：帖子正文 `![](https://evil.test/poc.svg)` 的远程 `.svg` 若被
 * svgInliner 内联会激活其中 `<script>`（「看见就中招」）。帖子 markdown 渲染管线
 * 必须给用户内容的 `<img>` 标记 `svg-inliner-ignore`，保持 `<img>` 而非内联执行。
 */
import { test, expect, openHome, expectPostInFeed } from './fixtures.mjs'

/** 恶意 SVG：内联后设置全局标记即证明脚本执行。 */
const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svgPwned = true</script></svg>'

test.describe('social post svg injection', () => {
	test('remote .svg in post markdown is not inlined', async ({ page, baseUrl, publishPost }) => {
		await openHome(page, baseUrl)
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

		const { postId } = await publishPost('![](https://evil.test/poc.svg)')
		await expectPostInFeed(page, postId)

		// 给 template/theme 的 svgInliner 机会执行（内联 fetch + 脚本）
		await page.waitForTimeout(2000)
		expect(await page.evaluate(() => window.__svgPwned === true)).toBe(false)

		// 图片应保持 `<img>`（未被替换为内联 `<svg>`）
		const card = page.locator(`[data-post-id="${postId}"]`)
		await expect(card.locator('img[src="https://evil.test/poc.svg"]')).toHaveCount(1)
	})
})
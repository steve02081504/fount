/**
 * embedCard（前端实跑）：模块顶层样式注入按模块挂载位置解析（subpath-safe），
 * renderEmbedCardHtml 对危险 URL 产出空卡。
 * 浏览器模块必须在浏览器里测（modulePage），断言回 Node 侧。
 */
import { expect, test } from './fixtures.mjs'

test.describe('embedCard', () => {
	test.describe.configure({ timeout: 600_000 })

	test('stylesheet href resolves beside the module (subpath-safe)', async ({ modulePage }) => {
		const result = await modulePage.run(async () => {
			await import('/scripts/features/embedCard.mjs')
			const link = document.head.querySelector('link[rel="stylesheet"][href*="embedCard.css"]')
			return {
				href: link?.href ?? '',
				origin: location.origin,
			}
		})
		expect(result.href).not.toBe('')
		expect(result.href.startsWith(`${result.origin}/`)).toBe(true)
		expect(result.href.endsWith('/scripts/features/embedCard.css')).toBe(true)
	})

	test('renderEmbedCardHtml keeps safe urls and drops unsafe ones', async ({ modulePage }) => {
		const cards = await modulePage.run(async () => {
			const embedCard = await import('/scripts/features/embedCard.mjs')
			return {
				safe: embedCard.renderEmbedCardHtml({ url: 'https://example.com/post', title: 't', description: 'd' }),
				javascript: embedCard.renderEmbedCardHtml({ url: 'javascript:alert(1)', title: 't' }),
				empty: embedCard.renderEmbedCardHtml({}),
			}
		})
		expect(cards.safe).toContain('<article class="fount-embed-card')
		expect(cards.safe).toContain('href="https://example.com/post"')
		expect(cards.javascript).toBe('')
		expect(cards.empty).toBe('')
	})
})

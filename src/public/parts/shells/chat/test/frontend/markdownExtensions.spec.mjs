/**
 * Chat markdown 扩展（前端实跑）：registry 模块导出结构 + inline token 解析。
 * 浏览器模块必须在浏览器里测（modulePage），断言回 Node 侧。
 */
import { expect, test } from './fixtures.mjs'

test.describe('chat markdown extensions', () => {
	test.describe.configure({ timeout: 600_000 })

	test('exports remark plugins, emoji css and init', async ({ modulePage }) => {
		const extension = await modulePage.run(async () => {
			const mod = await import('/parts/shells:chat/markdown_extensions/index.mjs')
			return {
				remarkPlugins: Array.isArray(mod.default.remarkPlugins) ? mod.default.remarkPlugins.length : -1,
				css: mod.default.css ?? '',
				hasInit: typeof mod.default.init === 'function',
				inlineTokens: mod.default.inlineTokens?.map(token => token.kind) ?? [],
			}
		})
		expect(extension.remarkPlugins).toBeGreaterThanOrEqual(1)
		expect(extension.css).toMatch(/fount-emoji/)
		expect(extension.hasInit).toBe(true)
		expect(extension.inlineTokens).toEqual(['emoji', 'mention', 'link'])
	})

	test('inline token parsers resolve mention / link bodies', async ({ modulePage }) => {
		const parsed = await modulePage.run(async () => {
			const mod = await import('/parts/shells:chat/markdown_extensions/index.mjs')
			const tokens = mod.default.inlineTokens
			const linkToken = tokens.find(token => token.kind === 'link')
			const mention = tokens.find(token => token.kind === 'mention').parse('@[entity:abc123]')
			const link = linkToken.parse('#[channel:group1/channel2]')
			const groupLink = linkToken.parse('#[group:g1]')
			return { mention, link, groupLink }
		})
		expect(parsed.mention.kind).toBe('mention')
		expect(parsed.mention.entityHash).toBe('abc123')
		expect(parsed.link.kind).toBe('link')
		expect(parsed.link.id).toBe('channel2')
		expect(parsed.groupLink.id).toBe('g1')
	})
})

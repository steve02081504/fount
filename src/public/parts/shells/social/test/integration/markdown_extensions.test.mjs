/**
 * Social markdown 扩展注册结构测试。
 */
/* global Deno */
import { assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const socialMarkdownExtensionPath = new URL('../../public/markdown_extensions/index.mjs', import.meta.url)

Deno.test('social markdown extension exports remark plugins', async () => {
	const source = await Deno.readTextFile(socialMarkdownExtensionPath)
	assertMatch(source, /remarkPlugins:\s*\[/)
	assertMatch(source, /remarkSocialDialect/)
})

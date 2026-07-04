/**
 * Social markdown 扩展注册结构测试。
 */
/* global Deno */
import { assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'

const socialMarkdownExtPath = new URL('../../public/markdown_ext/index.mjs', import.meta.url)

Deno.test('social markdown extension exports remark plugins', async () => {
	const source = await Deno.readTextFile(socialMarkdownExtPath)
	assertMatch(source, /remarkPlugins:\s*\[/)
	assertMatch(source, /remarkSocialDialect/)
})

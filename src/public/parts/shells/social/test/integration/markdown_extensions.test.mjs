/**
 * Social markdown 扩展注册结构测试。
 */
/* global Deno */
import { assertMatch } from 'jsr:@std/assert'

const socialMarkdownExtensionPath = new URL('../../public/markdown_extensions/index.mjs', import.meta.url)

Deno.test('social markdown extension exports remark plugins', async () => {
	const source = await Deno.readTextFile(socialMarkdownExtensionPath)
	assertMatch(source, /remarkPlugins:\s*\[/)
	assertMatch(source, /remarkSocialDialect/)
})

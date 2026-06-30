/**
 * 已注册 markdown 扩展模块结构单测。
 */
/* global Deno */
import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import chatMarkdownExt from '../public/parts/shells/chat/public/markdown_ext/index.mjs'

const socialMarkdownExtPath = new URL('../public/parts/shells/social/public/markdown_ext/index.mjs', import.meta.url)

Deno.test('chat markdown extension exports remark plugins and emoji css', () => {
	assertEquals(Array.isArray(chatMarkdownExt.remarkPlugins), true)
	assertEquals(chatMarkdownExt.remarkPlugins.length >= 1, true)
	assertMatch(chatMarkdownExt.css || '', /fount-emoji/)
	assertEquals(typeof chatMarkdownExt.init, 'function')
})

Deno.test('social markdown extension exports remark plugins', async () => {
	const source = await Deno.readTextFile(socialMarkdownExtPath)
	assertMatch(source, /remarkPlugins:\s*\[/)
	assertMatch(source, /remarkSocialDialect/)
})

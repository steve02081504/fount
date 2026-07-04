/**
 * Chat markdown 扩展导出结构测试。
 */
/* global Deno */
import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import chatMarkdownExt from '../../public/markdown_ext/index.mjs'

Deno.test('chat markdown extension exports remark plugins and emoji css', () => {
	assertEquals(Array.isArray(chatMarkdownExt.remarkPlugins), true)
	assertEquals(chatMarkdownExt.remarkPlugins.length >= 1, true)
	assertMatch(chatMarkdownExt.css || '', /fount-emoji/)
	assertEquals(typeof chatMarkdownExt.init, 'function')
})

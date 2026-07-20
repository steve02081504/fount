/**
 * Chat markdown 扩展导出结构测试。
 */
/* global Deno */
import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import chatMarkdownExtension from '../../public/markdown_extensions/index.mjs'

Deno.test('chat markdown extension exports remark plugins and emoji css', () => {
	assertEquals(Array.isArray(chatMarkdownExtension.remarkPlugins), true)
	assertEquals(chatMarkdownExtension.remarkPlugins.length >= 1, true)
	assertMatch(chatMarkdownExtension.css || '', /fount-emoji/)
	assertEquals(typeof chatMarkdownExtension.init, 'function')
})

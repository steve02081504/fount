/**
 * M5：telegrambot format 纯测试（无 server 依赖）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
	aiMarkdownToTelegramHtml,
	splitTelegramReply,
} from '../../src/format.mjs'

Deno.test('splitTelegramReply splits long HTML safely', () => {
	const parts = splitTelegramReply('a'.repeat(5000), 4096)
	assertEquals(parts.length, 2)
	assertEquals(parts.join('').length, 5000)
})

Deno.test('aiMarkdownToTelegramHtml bold', () => {
	const html = aiMarkdownToTelegramHtml('**hi**')
	assertEquals(html.includes('<b>hi</b>'), true)
})

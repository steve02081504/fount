/**
 * gemini `BuildPrompt`：出站 `{ contents }` 形态（含 system 提示）与附件二进制保留为 Buffer。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertInstanceOf } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

/** 最小 PNG 头（仅用于字节保真断言）。 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * 返回一个不会被 BuildPrompt 使用的假客户端。
 * @returns {object} 空客户端。
 */
const stubClient = () => ({})

Deno.test('gemini BuildPrompt returns { contents } with inlineData Buffer bytes and system prompt', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource(
		{ name: 'gemini-build-prompt', apikey: 'test-key', model: 'gemini-2.0-flash' },
		{ createAi: stubClient },
	)
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	const entry = conversation.addUser('看看这张图', 'user-1')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG }]

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assert(Array.isArray(out.contents) && out.contents.length > 0, 'contents array expected')
	const parts = out.contents.flatMap(content => content.parts || [])
	assert(parts.some(part => typeof part.text === 'string' && part.text.includes('<message')), 'message text expected')
	assert(parts.some(part => typeof part.text === 'string' && part.text.includes('system:')), 'system prompt expected')

	const inline = parts.find(part => part.inlineData)
	assert(inline, 'expected an inlineData part')
	assertEquals(inline.inlineData.mimeType, 'image/png')
	assertInstanceOf(inline.inlineData.data, Uint8Array)
	assertEquals(inline.inlineData.data.equals(PNG), true, 'attachment bytes must round-trip as Buffer')
})

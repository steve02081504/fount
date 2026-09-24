/**
 * claude-api `BuildPrompt`：出站 `{ system, messages }` 形态与图片二进制保留为 Buffer。
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

Deno.test('claude-api BuildPrompt returns { system, messages } with Buffer image bytes', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource(
		{ name: 'claude-build-prompt', apikey: 'test-key', model: 'claude-3-5-sonnet-20240620' },
		{ getClient: stubClient },
	)
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	const entry = conversation.addUser('看看这张图', 'user-1')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG }]

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assert(typeof out.system === 'string' && out.system.length > 0, 'system prompt expected')
	assert(Array.isArray(out.messages), 'messages array expected')

	const image = out.messages.flatMap(message => message.content).find(block => block.type === 'image')
	assert(image, 'expected an image block')
	assertEquals(image.source.type, 'base64')
	assertEquals(image.source.media_type, 'image/png')
	assertInstanceOf(image.source.data, Uint8Array)
	assertEquals(image.source.data.equals(PNG), true, 'image bytes must round-trip as Buffer')
})

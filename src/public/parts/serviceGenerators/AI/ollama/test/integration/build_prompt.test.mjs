/**
 * ollama `BuildPrompt`：消息数组形态与图片二进制保留为 Buffer（非 base64）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals, assertInstanceOf } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

Deno.test('ollama BuildPrompt returns messages with Buffer image bytes', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'ollama-build-prompt',
		host: 'http://127.0.0.1:11434',
		model: 'llama3',
	})
	const conversation = createPromptStructConversation({ charName: 'ZL-31', userName: 'Tester' })
	const entry = conversation.addUser('看看这张图', 'user-1')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG }]

	const out = await source.BuildPrompt(conversation.makePromptStruct())

	assertEquals(Array.isArray(out), true, 'BuildPrompt must return a bare messages array')
	const withImage = out.find(message => Array.isArray(message.images) && message.images.length)
	assert(withImage, 'expected a message carrying images')
	assertInstanceOf(withImage.images[0], Uint8Array, 'image bytes must stay binary')
	assertEquals(withImage.images[0].equals(PNG), true, 'attachment bytes must round-trip')
	assertEquals('images' in withImage && typeof withImage.images[0] === 'string', false, 'must not base64-encode')
	assert(out.some(message => message.role === 'system'), 'expected a system message')
})

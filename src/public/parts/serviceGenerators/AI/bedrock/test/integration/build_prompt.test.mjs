/**
 * Bedrock `BuildPrompt`：Converse `{ system, messages }` 形态与附件字节（Buffer，非 base64）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

Deno.test('Bedrock BuildPrompt builds Converse structure with Buffer attachment bytes', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'bedrock-buildprompt',
		model: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
		region: 'us-east-1',
		accessKeyId: 'test-key',
		secretAccessKey: 'test-secret',
		use_stream: false,
	})
	assertEquals(typeof source.BuildPrompt, 'function')

	const conversation = createPromptStructConversation()
	const entry = conversation.addUser('看图')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG, description: '' }]

	const body = await source.BuildPrompt(conversation.makePromptStruct())
	assert(Array.isArray(body.system), 'expected a system array')
	assert(Array.isArray(body.messages), 'expected a messages array')

	const imageBlock = body.messages.flatMap(message => message.content).find(part => part.image)
	assert(imageBlock, 'expected a Converse image block')
	assert(imageBlock.image.source.bytes instanceof Uint8Array, 'attachment bytes must stay bytes')
	assertEquals(imageBlock.image.format, 'png')
})

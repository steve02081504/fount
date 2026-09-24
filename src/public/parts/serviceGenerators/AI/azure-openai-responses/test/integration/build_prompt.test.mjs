/**
 * Azure OpenAI Responses `BuildPrompt`：经 createResponsesSource 继承的 Responses 请求体形态与 Buffer 附件字节。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

Deno.test('Azure Responses inherits BuildPrompt with Buffer attachment bytes', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'azure-buildprompt',
		model: 'gpt-4.1',
		apikey: 'azure-key',
		endpoint: 'https://demo.openai.azure.com',
		use_stream: false,
	})
	assertEquals(typeof source.BuildPrompt, 'function', 'Azure source must inherit BuildPrompt from createResponsesSource')

	const conversation = createPromptStructConversation()
	const entry = conversation.addUser('看图')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG, description: '' }]

	const body = await source.BuildPrompt(conversation.makePromptStruct())
	assertEquals(Array.isArray(body.input), true)
	assertEquals(body.input[0].role, 'user')

	const imagePart = body.input[0].content.find(part => part.type === 'image_url')
	assert(imagePart, 'expected an image_url part')
	assert(imagePart.image_url.data instanceof Uint8Array, 'attachment bytes must stay bytes')
	assertEquals('url' in imagePart.image_url, false)
})

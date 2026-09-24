/**
 * Codex `BuildPrompt`：Responses 请求体形态与附件字节（Buffer，非 base64）。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assert, assertEquals } from 'jsr:@std/assert'

import { createPromptStructConversation } from 'fount/scripts/test/fixtures/ai_conversation.mjs'

import generator from '../../main.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

Deno.test('Codex BuildPrompt builds Responses body with attachment bytes as Buffer', async () => {
	const source = await generator.interfaces.serviceGenerator.GetSource({
		name: 'codex-buildprompt',
		model: 'gpt-5.1-codex',
		use_stream: false,
		oauth: {
			access: 'tok',
			refresh: 'r',
			expires: Date.now() + 60_000,
			accountId: 'acct_x',
		},
	}, {
		/** GetSource 依赖桩：空 SaveConfig。 */
		SaveConfig: async () => { },
	})
	assertEquals(typeof source.BuildPrompt, 'function')

	const conversation = createPromptStructConversation()
	const entry = conversation.addUser('看图')
	entry.files = [{ name: 'a.png', mime_type: 'image/png', buffer: PNG, description: '' }]

	const body = await source.BuildPrompt(conversation.makePromptStruct())
	assertEquals(typeof body.instructions, 'string')
	assertEquals(Array.isArray(body.input), true)
	assertEquals(body.input[0].type, 'message')
	assertEquals(body.input[0].role, 'user')

	const imagePart = body.input[0].content.find(part => part.type === 'input_image')
	assert(imagePart, 'expected an input_image part')
	assert(imagePart.image_url.data instanceof Uint8Array, 'attachment bytes must stay bytes')
	assertEquals('url' in imagePart.image_url, false)
})

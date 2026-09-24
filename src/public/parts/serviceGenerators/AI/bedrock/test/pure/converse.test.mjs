/**
 * Bedrock Converse 消息映射。
 */
/* global Deno */
import { Buffer } from 'node:buffer'

import { assertEquals } from 'jsr:@std/assert'

import { messagesToConverse } from '../../src/converse.mjs'

Deno.test('messagesToConverse splits system', () => {
	assertEquals(messagesToConverse([
		{ role: 'system', content: 'sys' },
		{ role: 'user', content: 'hi' },
		{ role: 'assistant', content: 'yo' },
	]), {
		system: [{ text: 'sys' }],
		messages: [
			{ role: 'user', content: [{ text: 'hi' }] },
			{ role: 'assistant', content: [{ text: 'yo' }] },
		],
	})
})

Deno.test('messagesToConverse buffer mode keeps image bytes as Buffer', () => {
	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
	const result = messagesToConverse([
		{
			role: 'user',
			content: [
				{ type: 'text', text: '看图' },
				{ type: 'image_url', image_url: { mime_type: 'image/png', data: bytes } },
			],
		},
	], { binaryMode: 'buffer' })
	assertEquals(result.messages[0].content, [
		{ text: '看图' },
		{ image: { format: 'png', source: { bytes } } },
	])
})

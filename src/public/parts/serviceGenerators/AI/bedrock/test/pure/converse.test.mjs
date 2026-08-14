/**
 * Bedrock Converse 消息映射。
 */
/* global Deno */
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

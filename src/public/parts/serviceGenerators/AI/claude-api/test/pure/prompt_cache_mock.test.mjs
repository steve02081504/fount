/**
 * Anthropic prompt-cache mock 的纯逻辑（序列化）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { serializeClaudeRequest } from 'fount/scripts/test/fixtures/claude_prompt_cache_mock.mjs'

Deno.test('serializeClaudeRequest keeps system before messages', () => {
	const body = {
		system: 'You are a test char.',
		messages: [
			{ role: 'user', content: [{ type: 'text', text: 'hello' }] },
			{ role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
		],
	}
	assertEquals(
		serializeClaudeRequest(body),
		'You are a test char.\nuser\0hello\nassistant\0hi',
	)
})

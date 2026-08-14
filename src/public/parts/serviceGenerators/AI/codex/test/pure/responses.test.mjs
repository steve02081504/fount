/**
 * Responses 请求体与 output_text。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { messagesToResponsesBody, textFromResponsesJson } from '../../src/responsesClient.mjs'

Deno.test('Responses body and output_text parse', () => {
	const body = messagesToResponsesBody([
		{ role: 'system', content: 'sys' },
		{ role: 'user', content: 'hi' },
	], { model: 'gpt-4.1', stream: true })
	assertEquals(body.model, 'gpt-4.1')
	assertEquals(body.stream, true)
	assertEquals(body.store, false)
	assertEquals(body.instructions, 'sys')
	assertEquals(body.input[0].role, 'user')
	assertEquals(textFromResponsesJson({ output_text: 'done' }), 'done')
	assertEquals(textFromResponsesJson({
		output: [{ type: 'message', content: [{ type: 'output_text', text: 'z' }] }],
	}), 'z')
})

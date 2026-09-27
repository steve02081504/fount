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

Deno.test('Responses body keeps chosen Codex reasoning effort and other model arguments', () => {
	const body = messagesToResponsesBody([{ role: 'user', content: 'hi' }], {
		model: 'chosen-model',
		model_arguments: { reasoning: { effort: 'ultra', summary: 'auto' }, custom_option: 3 },
	})
	assertEquals(body.model, 'chosen-model')
	assertEquals(body.reasoning, { effort: 'ultra', summary: 'auto' })
	assertEquals(body.custom_option, 3)
})

Deno.test('Responses body serializes a multi-turn assistant history as output_text parts', () => {
	const body = messagesToResponsesBody([
		{ role: 'system', content: 'sys' },
		{ role: 'user', content: 'turn one' },
		{ role: 'assistant', content: 'turn one answer' },
		{ role: 'user', content: 'turn two' },
	], { model: 'gpt-4.1', stream: false })

	assertEquals(body.input.map(item => item.role), ['user', 'assistant', 'user'])
	const assistant = body.input[1]
	assertEquals(assistant.type, 'message')
	assertEquals(Array.isArray(assistant.content), true)
	assertEquals(assistant.content, [{ type: 'output_text', text: 'turn one answer' }])
})

Deno.test('Responses body maps chat multimodal parts to Responses content types', () => {
	const body = messagesToResponsesBody([
		{
			role: 'user',
			content: [
				{ type: 'text', text: 'look' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
			],
		},
		{
			role: 'assistant',
			content: [{ type: 'text', text: 'seen' }],
		},
	], { model: 'gpt-4.1', stream: false })

	assertEquals(body.input[0].content, [
		{ type: 'input_text', text: 'look' },
		{ type: 'input_image', image_url: 'data:image/png;base64,abc' },
	])
	assertEquals(body.input[1].content, [{ type: 'output_text', text: 'seen' }])
})

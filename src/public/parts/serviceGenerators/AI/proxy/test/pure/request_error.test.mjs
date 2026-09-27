/**
 * 请求错误的统一类型、回退判定与 Responses 参数映射的纯逻辑。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { toResponsesArguments } from '../../src/chatCompletion.mjs'
import { AIRequestError, isRetryableCandidateError, readErrorResponse } from '../../src/requestError.mjs'

Deno.test('readErrorResponse returns a real Error carrying status, url and payload', async () => {
	const response = new Response(JSON.stringify({ error: { message: 'boom' } }), {
		status: 400,
		headers: { 'Content-Type': 'application/json' },
	})
	const error = await readErrorResponse(response, { url: 'https://example.com/v1/chat/completions', apiStyle: 'chat' })
	assertEquals(error instanceof Error, true)
	assertEquals(error.name, 'AIRequestError')
	assertEquals(error.status, 400)
	assertEquals(error.apiStyle, 'chat')
	assertEquals(error.data.error.message, 'boom')
	assertEquals(error.message, 'chat 400 https://example.com/v1/chat/completions: boom')
})

Deno.test('readErrorResponse tolerates a non-JSON body', async () => {
	const error = await readErrorResponse(new Response('gateway timeout', { status: 504 }), { url: 'https://example.com' })
	assertEquals(error.status, 504)
	assertEquals(error.text, 'gateway timeout')
	assertEquals(error.message, '504 https://example.com: gateway timeout')
})

Deno.test('isRetryableCandidateError only retries endpoint mismatches', () => {
	assertEquals(isRetryableCandidateError(new AIRequestError('x', { status: 404 })), true)
	assertEquals(isRetryableCandidateError(new AIRequestError('x', { status: 405 })), true)
	assertEquals(isRetryableCandidateError(new AIRequestError('x', { status: 501 })), true)
	assertEquals(isRetryableCandidateError(new AIRequestError('x', { status: 400 })), false)
	assertEquals(isRetryableCandidateError(new AIRequestError('x', { status: 429 })), false)
	assertEquals(isRetryableCandidateError(new TypeError('fetch failed')), true)
	assertEquals(isRetryableCandidateError(new Error('other')), false)
})

Deno.test('toResponsesArguments maps chat-only and alias arguments', () => {
	const result = toResponsesArguments({
		temperature: 0.5,
		max_tokens: 100,
		max_completion_tokens: 200,
		reasoning_effort: 'high',
		n: 1,
		logprobs: true,
		top_logprobs: 5,
	})
	assertEquals(result.temperature, 0.5)
	assertEquals(result.max_output_tokens, 100)
	assertEquals(result.reasoning, { effort: 'high' })
	assertEquals('n' in result, false)
	assertEquals('logprobs' in result, false)
	assertEquals('top_logprobs' in result, false)
})

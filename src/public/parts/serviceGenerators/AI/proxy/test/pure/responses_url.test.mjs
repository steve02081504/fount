/**
 * Responses API URL 候选生成。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { responsesUrlCandidates, urlImpliesResponses } from '../../src/responsesUrl.mjs'

Deno.test('full responses URL is kept as-is', () => {
	assertEquals(
		responsesUrlCandidates('https://api.openai.com/v1/responses'),
		['https://api.openai.com/v1/responses'],
	)
})

Deno.test('chat/completions URL is rewritten to /v1/responses', () => {
	assertEquals(
		responsesUrlCandidates('https://opencode.ai/zen/v1/chat/completions'),
		['https://opencode.ai/zen/v1/responses'],
	)
})

Deno.test('/v1 base only appends /responses', () => {
	assertEquals(
		responsesUrlCandidates('https://api.openai.com/v1'),
		['https://api.openai.com/v1/responses'],
	)
})

Deno.test('origin-only base tries v1 then bare responses', () => {
	assertEquals(
		responsesUrlCandidates('https://api.example.com'),
		[
			'https://api.example.com/v1/responses',
			'https://api.example.com/responses',
		],
	)
})

Deno.test('custom path base keeps original then suffixes', () => {
	assertEquals(
		responsesUrlCandidates('https://gateway.example.com/openai'),
		[
			'https://gateway.example.com/openai/v1/responses',
			'https://gateway.example.com/openai/responses',
		],
	)
})

Deno.test('urlImpliesResponses detects responses endpoints', () => {
	assertEquals(urlImpliesResponses('https://api.openai.com/v1/responses'), true)
	assertEquals(urlImpliesResponses('https://opencode.ai/zen/v1/chat/completions'), false)
	assertEquals(urlImpliesResponses('not a url /responses'), true)
})

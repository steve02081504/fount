/**
 * OpenAI 兼容 API URL 候选生成。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { completionsUrlCandidates } from '../../src/completionsUrl.mjs'

Deno.test('full chat/completions URL is kept as-is', () => {
	assertEquals(
		completionsUrlCandidates('https://api.openai.com/v1/chat/completions'),
		['https://api.openai.com/v1/chat/completions'],
	)
})

Deno.test('/v1 base only appends /chat/completions', () => {
	assertEquals(
		completionsUrlCandidates('https://api.moonshot.cn/v1'),
		['https://api.moonshot.cn/v1/chat/completions'],
	)
	assertEquals(
		completionsUrlCandidates('https://api.moonshot.cn/v1/'),
		['https://api.moonshot.cn/v1/chat/completions'],
	)
})

Deno.test('origin-only base tries v1 then bare completions', () => {
	assertEquals(
		completionsUrlCandidates('https://api.example.com'),
		[
			'https://api.example.com/',
			'https://api.example.com/v1/chat/completions',
			'https://api.example.com/chat/completions',
		],
	)
})

Deno.test('custom path base keeps original then suffixes', () => {
	assertEquals(
		completionsUrlCandidates('https://gateway.example.com/openai'),
		[
			'https://gateway.example.com/openai',
			'https://gateway.example.com/openai/v1/chat/completions',
			'https://gateway.example.com/openai/chat/completions',
		],
	)
})

Deno.test('collapses historically doubled /v1/v1', () => {
	assertEquals(
		completionsUrlCandidates('https://api.moonshot.cn/v1/v1/chat/completions'),
		['https://api.moonshot.cn/v1/chat/completions'],
	)
})

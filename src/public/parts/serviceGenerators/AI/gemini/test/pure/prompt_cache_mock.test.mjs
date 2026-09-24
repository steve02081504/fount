/**
 * Gemini prompt-cache mock 的纯逻辑（序列化 + 前缀统计）。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { serializeGeminiContents } from 'fount/scripts/test/fixtures/gemini_prompt_cache_mock.mjs'
import { createPrefixCacheTracker } from 'fount/scripts/test/fixtures/prompt_cache_tracker.mjs'

Deno.test('serializeGeminiContents keeps role and text order', () => {
	const contents = [
		{ role: 'user', parts: [{ text: 'hello' }] },
		{ role: 'model', parts: [{ text: 'hi' }] },
	]
	assertEquals(serializeGeminiContents(contents), 'user\0hello\nmodel\0hi')
})

Deno.test('prefix tracker marks append-only rounds as grewOnly', () => {
	const tracker = createPrefixCacheTracker()
	tracker.record('system\nuser: one')
	tracker.record('system\nuser: one\nmodel: a')
	tracker.record('system\nuser: one\nmodel: a\nuser: two')
	const summary = tracker.stats()
	assertEquals(summary.allGrewOnly, true)
	assertEquals(summary.minCommonWithFirstTokens, summary.firstPromptTokens)
})

Deno.test('prefix tracker detects head divergence', () => {
	const tracker = createPrefixCacheTracker()
	tracker.record('system A\nuser: one')
	const row = tracker.record('system B\nuser: one')
	assertEquals(row.grewOnly, false)
	assertEquals(row.divergeAt.index, 7)
})

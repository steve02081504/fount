/**
 * 估算分词器与 AI 源上下文的纯逻辑。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { estimateTokenCount, identityTokenizer, minKnownContextSize } from '../../src/identityTokenizer.mjs'

Deno.test('estimateTokenCount approximates ASCII at 4 chars/token and ideographic scripts at 1 char/token', () => {
	assertEquals(estimateTokenCount(''), 0)
	assertEquals(estimateTokenCount(undefined), 0)
	assertEquals(estimateTokenCount('abcd'), 1)
	assertEquals(estimateTokenCount('abcde'), 2)
	assertEquals(estimateTokenCount('你好'), 2)
	assertEquals(estimateTokenCount('こんにちは'), 5)
	assertEquals(estimateTokenCount('안녕'), 2)
	assertEquals(estimateTokenCount('😀'), 1)
	assertEquals(estimateTokenCount('你好abcd'), 3)
})

Deno.test('estimateTokenCount treats other non-ASCII letter scripts at 2 chars/token', () => {
	assertEquals(estimateTokenCount('привет'), 3)
	assertEquals(estimateTokenCount('αβγ'), 2)
	assertEquals(estimateTokenCount('مرحبا'), 3)
})

Deno.test('identityTokenizer is transparent and counts via the estimator', () => {
	assertEquals(identityTokenizer.encode('abc'), 'abc')
	assertEquals(identityTokenizer.decode('abc'), 'abc')
	assertEquals(identityTokenizer.decode_single('a'), 'a')
	assertEquals(identityTokenizer.free(), 0)
	assertEquals(identityTokenizer.get_token_count('你好abcd'), 3)
})

Deno.test('minKnownContextSize takes the smallest known value and ignores unknown sources', () => {
	assertEquals(minKnownContextSize([{ context_size: 100 }, { context_size: 50 }, {}]), 50)
	assertEquals(minKnownContextSize([{}, undefined]), undefined)
	assertEquals(minKnownContextSize([]), undefined)
})

/**
 * OpenAI prompt-cache mock 的纯逻辑。
 */
/* global Deno */
import {
	CACHE_TOKEN_INCREMENT,
	MIN_CACHE_TOKENS,
	cachedTokensFromPrefix,
	longestCommonPrefixLength,
	serializeMessages,
} from 'fount/scripts/test/fixtures/openai_prompt_cache_mock.mjs'
import { assertEquals } from 'jsr:@std/assert'


Deno.test('serializeMessages is stable for identical payloads', () => {
	const messages = [
		{ role: 'system', content: 'static' },
		{ role: 'user', content: 'hello' },
	]
	assertEquals(serializeMessages(messages), serializeMessages(structuredClone(messages)))
})

Deno.test('cachedTokensFromPrefix respects min and 128 increments', () => {
	assertEquals(cachedTokensFromPrefix(MIN_CACHE_TOKENS - 1), 0)
	assertEquals(cachedTokensFromPrefix(MIN_CACHE_TOKENS), MIN_CACHE_TOKENS)
	assertEquals(
		cachedTokensFromPrefix(MIN_CACHE_TOKENS + CACHE_TOKEN_INCREMENT + 7),
		MIN_CACHE_TOKENS + CACHE_TOKEN_INCREMENT,
	)
})

Deno.test('longestCommonPrefixLength finds shared prefix', () => {
	assertEquals(longestCommonPrefixLength('abcdef', 'abcxyz'), 3)
	assertEquals(longestCommonPrefixLength('same', 'same'), 4)
	assertEquals(longestCommonPrefixLength('', 'abc'), 0)
})

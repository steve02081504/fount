/**
 * Social @ 提及解析单元测试（Deno）。
 */
/* global Deno */
import { extractMentionEntityHashes } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { assertEquals } from 'jsr:@std/assert'


const SAMPLE_HASH = 'a'.repeat(128)

Deno.test('extractMentionEntityHashes finds bracketed 128-hex mentions', () => {
	const text = `hi @[entity:${SAMPLE_HASH}] and @[entity:${'b'.repeat(128)}]`
	assertEquals(extractMentionEntityHashes(text), [SAMPLE_HASH, 'b'.repeat(128)])
})

Deno.test('extractMentionEntityHashes ignores bare @128hex', () => {
	assertEquals(extractMentionEntityHashes(`@${SAMPLE_HASH}`), [])
	assertEquals(extractMentionEntityHashes('@abcdef'), [])
	assertEquals(extractMentionEntityHashes(''), [])
})

Deno.test('extractMentionEntityHashes dedupes', () => {
	const text = `@[entity:${SAMPLE_HASH}] @[entity:${SAMPLE_HASH}]`
	assertEquals(extractMentionEntityHashes(text), [SAMPLE_HASH])
})

Deno.test('extractMentionEntityHashes rejects mixed-case hex', () => {
	assertEquals(extractMentionEntityHashes(`@[entity:${SAMPLE_HASH.toUpperCase()}]`), [])
	const mixedCase = `@[entity:${SAMPLE_HASH}] @[entity:${SAMPLE_HASH.toUpperCase()}]`
	assertEquals(extractMentionEntityHashes(mixedCase), [SAMPLE_HASH])
})

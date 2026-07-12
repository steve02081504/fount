/**
 * Social @ 提及解析单元测试（Deno）。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { extractMentionEntityHashes } from 'fount/public/pages/scripts/lib/mentions.mjs'

const SAMPLE_HASH = 'a'.repeat(128)

Deno.test('extractMentionEntityHashes finds bracketed 128-hex mentions', () => {
	const text = `hi @[${SAMPLE_HASH}] and @[${'b'.repeat(128)}]`
	const found = extractMentionEntityHashes(text)
	assertEquals(found.length, 2)
	assertEquals(found[0], SAMPLE_HASH)
})

Deno.test('extractMentionEntityHashes ignores bare @128hex legacy syntax', () => {
	assertEquals(extractMentionEntityHashes(`@${SAMPLE_HASH}`), [])
	assertEquals(extractMentionEntityHashes('@abcdef'), [])
	assertEquals(extractMentionEntityHashes(''), [])
})

Deno.test('extractMentionEntityHashes dedupes', () => {
	const text = `@[${SAMPLE_HASH}] @[${SAMPLE_HASH.toUpperCase()}]`
	assertEquals(extractMentionEntityHashes(text).length, 1)
})

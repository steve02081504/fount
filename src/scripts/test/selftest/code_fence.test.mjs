/**
 * ensureClosedTrailingCodeFence：流式正文以未闭合围栏结尾时的安全终止。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { ensureClosedTrailingCodeFence } from '../../../public/pages/scripts/features/markdown/codeFence.mjs'

Deno.test('closing fence keeps existing trailing newline (no double newline)', () => {
	const text = '```\ncode line\n'
	assertEquals(ensureClosedTrailingCodeFence(text), '```\ncode line\n```')
})

Deno.test('closing fence adds a newline before the fence when text lacks one', () => {
	const text = '```\ncode line'
	assertEquals(ensureClosedTrailingCodeFence(text), '```\ncode line\n```')
})

Deno.test('complete text with a balanced fence is returned unchanged', () => {
	const text = '```\na\n```'
	assertEquals(ensureClosedTrailingCodeFence(text), text)
})

Deno.test('empty fence content removes the opening fence line', () => {
	assertEquals(ensureClosedTrailingCodeFence('```\n\n'), '')
})

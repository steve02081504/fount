/**
 * part_query 来源节点取值与屏蔽判定。
 */
/* global Deno */
import { assertEquals, assertFalse } from 'https://deno.land/std/assert/mod.ts'

import { isSourceNodeBlocked, sourceNodesOf } from '../../../../../../scripts/p2p/source_block.mjs'

Deno.test('sourceNodesOf reads row sources or falls back to empty', () => {
	const sources = new Map([['k', ['aa']]])
	assertEquals(sourceNodesOf(sources, 'k'), ['aa'])
	assertEquals(sourceNodesOf(sources, 'missing'), [])
	assertEquals(sourceNodesOf(undefined, 'k'), [])
	assertEquals(sourceNodesOf(sources, ''), [])
})

Deno.test('isSourceNodeBlocked ignores empty and missing hashes', () => {
	assertFalse(isSourceNodeBlocked(''))
	assertFalse(isSourceNodeBlocked(undefined))
	assertFalse(isSourceNodeBlocked(null))
})

/**
 * DAG 悬挂父检测单元测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { hasDanglingParents } from '../../governance_branch.mjs'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

Deno.test('hasDanglingParents: empty events', () => {
	assertEquals(hasDanglingParents([]), false)
})

Deno.test('hasDanglingParents: root event without parents', () => {
	assertEquals(hasDanglingParents([{ id: A, prev_event_ids: [] }]), false)
})

Deno.test('hasDanglingParents: complete chain', () => {
	assertEquals(hasDanglingParents([
		{ id: A, prev_event_ids: [] },
		{ id: B, prev_event_ids: [A] },
	]), false)
})

Deno.test('hasDanglingParents: missing parent reference', () => {
	assertEquals(hasDanglingParents([
		{ id: B, prev_event_ids: [A] },
	]), true)
})

Deno.test('hasDanglingParents: tip with dangling ancestor gap', () => {
	assertEquals(hasDanglingParents([
		{ id: A, prev_event_ids: [] },
		{ id: C, prev_event_ids: [B] },
	]), true)
})

/**
 * incomingBatch 分类：batch 内重复 eventId 不得被 append 两次；已在展示列表的行走 replace。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { classifyIncomingBatch } from '../../public/hub/messages/incomingBatch.mjs'

/** @param {string} id @param {number} ts @returns {object} 消息行 */
const row = (id, ts = 0) => ({ eventId: id, timestamp: ts })

Deno.test('same eventId twice in one batch appends only once', () => {
	const source = []
	const view = [row('a', 1)]
	const { replaceRows, appendRows } = classifyIncomingBatch([row('a'), row('a')], source, view)
	assertEquals(appendRows.length, 1)
	assertEquals(replaceRows.length, 0)
})

Deno.test('already displayed row goes to replace, deduped by index', () => {
	const source = [row('a', 1)]
	const view = [row('a', 1)]
	const { replaceRows, appendRows } = classifyIncomingBatch([row('a'), row('a')], source, view)
	assertEquals(replaceRows.length, 1)
	assertEquals(replaceRows[0].index, 0)
	assertEquals(appendRows.length, 0)
})

Deno.test('mixed new + existing rows classified correctly', () => {
	const source = [row('old', 1)]
	const view = [row('old', 1), row('new', 2)]
	const { replaceRows, appendRows } = classifyIncomingBatch([row('new'), row('old')], source, view)
	assertEquals(replaceRows.length, 1)
	assertEquals(replaceRows[0].row.eventId, 'old')
	assertEquals(appendRows.length, 1)
	assertEquals(appendRows[0].eventId, 'new')
})

Deno.test('row not present in view is skipped', () => {
	const { replaceRows, appendRows } = classifyIncomingBatch([row('ghost')], [], [])
	assertEquals(replaceRows.length, 0)
	assertEquals(appendRows.length, 0)
})

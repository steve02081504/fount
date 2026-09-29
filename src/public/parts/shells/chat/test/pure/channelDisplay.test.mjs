/**
 * 频道展示链：非 hex64 的乐观 pending 行不得被 DAG 折叠丢弃，恒排在链尾。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { applyChannelDisplayChain } from '../../public/src/ui/channelDisplay.mjs'

/**
 * 构造 64 位十六进制 eventId。
 * @param {string} char 重复字符
 * @returns {string} 64 位 hex
 */
const hex = char => char.repeat(64)

/**
 * 构造消息行。
 * @param {string} eventId 事件 ID
 * @param {string[]} [parents] 父 eventId
 * @param {number} [timestamp] 时间戳
 * @returns {object} 消息行
 */
const message = (eventId, parents = [], timestamp = 0) => ({
	eventId,
	prev_event_ids: parents,
	timestamp,
	content: { content: eventId },
})

/**
 * 构造乐观 pending 行。
 * @param {string} id pending id
 * @param {number} timestamp 时间戳
 * @returns {object} pending 行
 */
const pending = (id, timestamp) => ({
	eventId: id,
	pending: true,
	content: { content: id },
	timestamp,
})

Deno.test('pending row survives external-parent branch', () => {
	const external = hex('f')
	const rows = [
		message(hex('a'), [external], 1),
		pending('pending:1', 2),
	]
	const out = applyChannelDisplayChain(rows)
	assertEquals(out.map(row => row.eventId), [hex('a'), 'pending:1'])
})

Deno.test('pending row survives no-branch chain', () => {
	const rows = [
		message(hex('a'), [], 1),
		message(hex('b'), [hex('a')], 2),
		pending('pending:1', 3),
	]
	const out = applyChannelDisplayChain(rows)
	assertEquals(out.map(row => row.eventId), [hex('a'), hex('b'), 'pending:1'])
})

Deno.test('pending row survives branch folding and stays last', () => {
	const rows = [
		message(hex('a'), [], 1),
		message(hex('b'), [hex('a')], 2),
		message(hex('c'), [hex('a')], 3),
		pending('pending:1', 4),
	]
	const out = applyChannelDisplayChain(rows)
	assertEquals(out.at(-1).eventId, 'pending:1')
	assertEquals(out.filter(row => row.pending).length, 1)
})

Deno.test('multiple pending rows are appended at tail sorted by timestamp', () => {
	const rows = [
		message(hex('a'), [hex('f')], 1),
		pending('pending:2', 20),
		pending('pending:1', 10),
	]
	const out = applyChannelDisplayChain(rows)
	assertEquals(out.map(row => row.eventId), [hex('a'), 'pending:1', 'pending:2'])
})

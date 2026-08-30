/**
 * 缺陷回归：`reactionsSignature` 曾用 `JSON.stringify(reactions, Object.keys(reactions).sort())`
 * 生成签名——replacer 数组会连同嵌套对象键一并过滤，结果签名只反映「哪些消息有反应」。
 * 于是同一消息上「先点一个反应，随后又新增反应」时签名不变，`doRefreshChannelMessagesIncremental`
 * 据此跳过 `patchReactionRows`，新增的 emoji 一直不显示（点击反应后后续反应被取消显示）。
 * 本测试要求签名随同消息上任意 emoji / 投票者的增删而变化，且与键插入顺序无关。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'

import { reactionsSignature } from '../../public/hub/messages/reactionSignature.mjs'

const EVENT = 'a'.repeat(64)
const VIEWER = 'v'.repeat(64)
const FRIEND = 'f'.repeat(64)

/**
 * @param {Record<string, unknown>} eventMap 消息反应
 * @returns {Record<string, unknown>} 反应映射
 */
const map = eventMap => ({ [EVENT]: eventMap })

Deno.test('signature changes when a new emoji is added to an already-reacted message', () => {
	const before = reactionsSignature(map({ '👍': { voters: [VIEWER] } }))
	const after = reactionsSignature(map({ '👍': { voters: [VIEWER] }, '❤️': { voters: [FRIEND] } }))
	assertEquals(before === after, false)
})

Deno.test('signature changes when a voter joins an existing emoji', () => {
	const before = reactionsSignature(map({ '👍': { voters: [VIEWER] } }))
	const after = reactionsSignature(map({ '👍': { voters: [VIEWER, FRIEND] } }))
	assertEquals(before === after, false)
})

Deno.test('signature changes when a voter is removed', () => {
	const before = reactionsSignature(map({ '👍': { voters: [VIEWER, FRIEND] } }))
	const after = reactionsSignature(map({ '👍': { voters: [VIEWER] } }))
	assertEquals(before === after, false)
})

Deno.test('signature changes when an emoji is removed entirely', () => {
	const before = reactionsSignature(map({ '👍': { voters: [VIEWER] }, '❤️': { voters: [FRIEND] } }))
	const after = reactionsSignature(map({ '👍': { voters: [VIEWER] } }))
	assertEquals(before === after, false)
})

Deno.test('signature changes when another message gains a reaction', () => {
	const before = reactionsSignature({ [EVENT]: { '👍': { voters: [VIEWER] } } })
	const after = reactionsSignature({
		[EVENT]: { '👍': { voters: [VIEWER] } },
		['b'.repeat(64)]: { '❤️': { voters: [FRIEND] } },
	})
	assertEquals(before === after, false)
})

Deno.test('signature is invariant to object key insertion order', () => {
	const a = reactionsSignature(map({ '👍': { voters: [VIEWER] }, '❤️': { voters: [FRIEND] } }))
	const b = reactionsSignature(map({ '❤️': { voters: [FRIEND] }, '👍': { voters: [VIEWER] } }))
	assertEquals(a, b)
})

Deno.test('signature is empty for undefined / empty reactions', () => {
	assertEquals(reactionsSignature(undefined), '')
	assertEquals(reactionsSignature(null), '')
	assertEquals(reactionsSignature({}), '')
})

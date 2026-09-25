/* global Deno */
/**
 * generationChain.mjs 纯函数测试：按会话聚合与按 parentId 构建链森林。
 */
import { assertEquals } from 'jsr:@std/assert'

import { buildChains, conversationKey, groupByConversation, mergeDialogueEvents, minCacheRateByChar, summarizeConversations } from '../../public/shared/generationChain.mjs'

Deno.test('groupByConversation falls back to chatId and keeps empty key', () => {
	const groups = groupByConversation([
		{ id: '1', conversationId: 'conv', chatId: 'chat' },
		{ id: '2', chatId: 'chat' },
		{ id: '3' },
	])
	assertEquals([...groups.keys()], ['conv', 'chat', ''])
	assertEquals(groups.get('chat').map(record => record.id), ['2'])
	assertEquals(groups.get('').length, 1)
})

Deno.test('buildChains links children to parents and keeps orphans as roots', () => {
	const roots = buildChains([
		{ id: 'a' },
		{ id: 'b', parentId: 'a' },
		{ id: 'c', parentId: 'b' },
		{ id: 'orphan', parentId: 'missing' },
	])
	assertEquals(roots.map(node => node.record.id), ['a', 'orphan'])
	const root = roots.find(node => node.record.id === 'a')
	assertEquals(root.children[0].record.id, 'b')
	assertEquals(root.children[0].children[0].record.id, 'c')
})

Deno.test('buildChains tolerates empty or missing input', () => {
	assertEquals(buildChains([]), [])
	assertEquals(buildChains(undefined), [])
	assertEquals(groupByConversation(null).size, 0)
})

Deno.test('conversationKey prefers conversationId, then chatId, then record id', () => {
	assertEquals(conversationKey({ id: 'a', conversationId: 'conv', chatId: 'chat' }), 'conv')
	assertEquals(conversationKey({ id: 'a', chatId: 'chat' }), 'chat')
	assertEquals(conversationKey({ id: 'a' }), 'a')
})

Deno.test('summarizeConversations groups by key and orders by latest activity', () => {
	const summaries = summarizeConversations([
		{ id: 'g1', charId: 'c', conversationId: 'conv', startedAt: 100, finishedAt: 120, requestCount: 1 },
		{ id: 'g2', charId: 'c', conversationId: 'conv', startedAt: 90, finishedAt: 200, hasError: true, requestCount: 2 },
		{ id: 'g3', charId: 'c', chatId: 'chat', startedAt: 150, finishedAt: 160 },
	])
	assertEquals(summaries.map(summary => summary.key), ['conv', 'chat'])
	const conv = summaries[0]
	assertEquals(conv.generationCount, 2)
	assertEquals(conv.errorCount, 1)
	assertEquals(conv.requestCount, 3)
	assertEquals(conv.startedAt, 90)
	assertEquals(conv.finishedAt, 200)
	assertEquals(summaries[1].generationCount, 1)
})

Deno.test('summarizeConversations keeps the lowest cache rate per conversation', () => {
	const summaries = summarizeConversations([
		{ id: 'g1', charId: 'c', conversationId: 'conv', cacheRate: 0.8 },
		{ id: 'g2', charId: 'c', conversationId: 'conv', cacheRate: 0.35 },
		{ id: 'g3', charId: 'c', conversationId: 'conv' },
		{ id: 'g4', charId: 'c', chatId: 'chat' },
	])
	assertEquals(summaries.find(summary => summary.key === 'conv').minCacheRate, 0.35)
	assertEquals(summaries.find(summary => summary.key === 'chat').minCacheRate, null)
})

Deno.test('mergeDialogueEvents offsets each generation by its round span so replay stays aligned', () => {
	const generations = [
		{
			id: 'g1', requestCount: 4,
			dialogue: {
				rounds: 4,
				events: [
					{ round: 1, op: 'insert', message: { id: 'u', role: 'user', content: 'hi' } },
					{ round: 4, op: 'insert', message: { id: 'c1', role: 'char', content: 'r4' } },
					{ round: 4, op: 'insert', message: { id: 'final1', role: 'char', content: 'bye' } },
				],
			},
		},
		{
			id: 'g2', requestCount: 1,
			dialogue: {
				rounds: 1,
				events: [
					{ round: 1, op: 'insert', message: { id: 'u2', role: 'user', content: 'next' } },
					{ round: 1, op: 'insert', message: { id: 'final2', role: 'char', content: 'ans' } },
				],
			},
		},
	]
	const merged = mergeDialogueEvents(generations)
	// g1 占 1..4，g2 顺延到第 5 轮，总轮次与前端 buildRoundUnits 一致
	assertEquals(merged.rounds, 5)
	assertEquals(merged.events.map(event => [event.message.id, event.round]), [['u', 1], ['c1', 4], ['final1', 4], ['u2', 5], ['final2', 5]])
	assertEquals(merged.messages.map(message => message.content), ['hi', 'r4', 'bye', 'next', 'ans'])
})

Deno.test('mergeDialogueEvents drops a superseded final reply when the same user turn is re-run', () => {
	const generations = [
		{
			id: 'g1', requestCount: 1,
			dialogue: {
				rounds: 1,
				events: [
					{ round: 1, op: 'insert', message: { id: 'u', role: 'user', content: 'express 版本?' } },
					{ round: 1, op: 'insert', message: { id: 'r1', role: 'char', content: '我猜一下…' } },
				],
			},
		},
		{
			id: 'g2', requestCount: 1,
			dialogue: {
				rounds: 1,
				// 重放同一用户回合，但未携带 g1 的最终回复 r1
				events: [
					{ round: 1, op: 'insert', message: { id: 'u', role: 'user', content: 'express 版本?' } },
					{ round: 1, op: 'insert', message: { id: 'r2', role: 'char', content: 'deno.json 里是 ^5.1.0' } },
				],
			},
		},
	]
	const merged = mergeDialogueEvents(generations)
	// r1 被 g2 取代，不应出现在合并对话中
	assertEquals(merged.messages.map(message => message.content), ['express 版本?', 'deno.json 里是 ^5.1.0'])
})

Deno.test('mergeDialogueEvents keeps both finals when the next generation is a genuine new turn', () => {
	const generations = [
		{
			id: 'g1', requestCount: 1,
			dialogue: {
				rounds: 1,
				events: [
					{ round: 1, op: 'insert', message: { id: 'u1', role: 'user', content: 'hi' } },
					{ round: 1, op: 'insert', message: { id: 'r1', role: 'char', content: 'hello' } },
				],
			},
		},
		{
			id: 'g2', requestCount: 1,
			dialogue: {
				rounds: 1,
				events: [
					// 新一轮的请求携带上一轮历史（含 r1）与新的用户输入 u2
					{ round: 1, op: 'insert', message: { id: 'u1', role: 'user', content: 'hi' } },
					{ round: 1, op: 'insert', message: { id: 'r1', role: 'char', content: 'hello' } },
					{ round: 1, op: 'insert', message: { id: 'u2', role: 'user', content: 'bye' } },
					{ round: 1, op: 'insert', message: { id: 'r2', role: 'char', content: 'see ya' } },
				],
			},
		},
	]
	const merged = mergeDialogueEvents(generations)
	assertEquals(merged.messages.map(message => message.content), ['hi', 'hello', 'bye', 'see ya'])
})

Deno.test('minCacheRateByChar picks the lowest finite rate per character', () => {
	const result = minCacheRateByChar([
		{ charId: 'a', cacheRate: 0.7 },
		{ charId: 'a', cacheRate: 0.2 },
		{ charId: 'a', cacheRate: null },
		{ charId: 'b' },
		{ charId: 'b', cacheRate: 0.9 },
	])
	assertEquals(result, { a: 0.2, b: 0.9 })
})

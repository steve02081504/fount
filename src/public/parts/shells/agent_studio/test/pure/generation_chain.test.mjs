/* global Deno */
/**
 * generationChain.mjs 纯函数测试：按会话聚合与按 parentId 构建链森林。
 */
import { assertEquals } from 'jsr:@std/assert'

import { buildChains, conversationKey, groupByConversation, minCacheRateByChar, summarizeConversations } from '../../public/shared/generationChain.mjs'

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

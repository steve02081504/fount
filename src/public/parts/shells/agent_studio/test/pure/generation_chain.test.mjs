/* global Deno */
/**
 * generationChain.mjs 纯函数测试：按会话聚合与按 parentId 构建链森林。
 */
import { assertEquals } from 'jsr:@std/assert'

import { buildChains, groupByConversation } from '../../public/shared/generationChain.mjs'

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

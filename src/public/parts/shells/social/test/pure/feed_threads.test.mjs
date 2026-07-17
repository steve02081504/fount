/**
 * 同页自回复 thread 合并。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { groupSelfReplyThreads } from '../../public/src/lib/feedThreads.mjs'

Deno.test('groupSelfReplyThreads merges self-reply chain in chronological order', () => {
	const author = 'a'.repeat(128)
	const root = {
		kind: 'post',
		entityHash: author,
		postId: 'p1',
		hlc: { wall: 1 },
		post: { content: { text: 'root' } },
	}
	const reply = {
		kind: 'post',
		entityHash: author,
		postId: 'p2',
		hlc: { wall: 2 },
		replyContext: { entityHash: author, postId: 'p1' },
		post: { content: { text: 'reply', replyTo: { entityHash: author, postId: 'p1' } } },
	}
	// feed 新→旧
	const groups = groupSelfReplyThreads([reply, root])
	assertEquals(groups.length, 1)
	assertEquals(groups[0].type, 'thread')
	assertEquals(groups[0].items.map(i => i.postId), ['p1', 'p2'])
})

Deno.test('groupSelfReplyThreads keeps foreign replies separate', () => {
	const a = 'a'.repeat(128)
	const b = 'b'.repeat(128)
	const root = {
		kind: 'post',
		entityHash: a,
		postId: 'p1',
		hlc: { wall: 1 },
		post: { content: {} },
	}
	const foreign = {
		kind: 'post',
		entityHash: b,
		postId: 'p2',
		hlc: { wall: 2 },
		replyContext: { entityHash: a, postId: 'p1' },
		post: { content: { replyTo: { entityHash: a, postId: 'p1' } } },
	}
	const groups = groupSelfReplyThreads([foreign, root])
	assertEquals(groups.length, 2)
	assertEquals(groups.every(g => g.type === 'single'), true)
})

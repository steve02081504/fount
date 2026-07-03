/**
 * follower 索引层：薄封装在 p2p social，无 legacy following.json 旁路。
 * following 读写集成见 integration/timeline.test.mjs。
 * 离线 harness 下 fanout 自然为 0（P2P 关闭）；setFollow 仍走 commitTimelineEvent。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

Deno.test('setFollow uses commitTimelineEvent (fanout offline returns 0 in harness)', async () => {
	const { username, operator } = await getSession()
	const following = await import('../../src/following.mjs')
	const append = await import('../../src/timeline/append.mjs')
	const TARGET = placeholderEntityHash('e')

	const before = await append.readTimelineEvents(username, operator)
	const list = await following.setFollow(username, operator, TARGET, true)
	assert(list.includes(TARGET))
	const after = await append.readTimelineEvents(username, operator)
	assertEquals(after.length, before.length + 1)
	assertEquals(after.at(-1)?.type, 'follow')
	await following.setFollow(username, operator, TARGET, false)
})

/**
 * follower 索引层：薄封装在 p2p social，无 legacy following.json 旁路。
 * following 读写集成见 batch1_timeline.test.mjs。
 * 离线 harness 下 fanout 自然为 0（P2P 关闭）；setFollow 仍走 commitTimelineEvent。
 */
/* global Deno */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { bootstrap } from './harness.mjs'

Deno.test('follower index lives in p2p social layer', async () => {
	const url = new URL('../../../../../scripts/p2p/social/follower_index.mjs', import.meta.url)
	const text = await readFile(fileURLToPath(url), 'utf8')
	assert(text.includes('listReplicaUsernamesFollowing'))
	assert(text.includes('follower_index'))
	assert(text.includes('followerEntryCache'))
	assert(!text.includes('legacyPath'))
})

Deno.test('setFollow uses commitTimelineEvent (fanout offline returns 0 in harness)', async () => {
	const { username, operator } = await bootstrap()
	const following = await import('../src/following.mjs')
	const append = await import('../src/timeline/append.mjs')
	const TARGET = 'e'.repeat(128)

	const before = await append.readTimelineEvents(username, operator)
	const list = await following.setFollow(username, TARGET, true)
	assert(list.includes(TARGET))
	const after = await append.readTimelineEvents(username, operator)
	assertEquals(after.length, before.length + 1)
	assertEquals(after.at(-1)?.type, 'follow')
	await following.setFollow(username, TARGET, false)
})

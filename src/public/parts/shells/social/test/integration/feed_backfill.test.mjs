/**
 * Feed 联邦补给：post_discover handler + backfill 短路 / 入库。
 */
/* global Deno */
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

Deno.test('localPostDiscoverHandler returns signed public post events', async () => {
	const { username, operator } = await getSession()
	const append = await import('../../src/timeline/append.mjs')
	const { localPostDiscoverHandler } = await import('../../src/discover/postDiscover.mjs')

	const event = await append.commitTimelineEvent(username, operator, {
		type: 'post',
		content: { text: 'backfill-discover-sample', visibility: 'public' },
	}, { fanout: false })

	const rows = await localPostDiscoverHandler({ replicaUsername: username }, { limit: 10 })
	const hit = rows.find(row => row.postId === event.id)
	assert(hit, 'discovered row missing')
	assertEquals(hit.entityHash, operator)
	assert(hit.event?.signature, 'event must carry signature')
	assertEquals(hit.event?.content?.visibility, 'public')
})

Deno.test('backfillPosts short-circuits when enough already', async () => {
	const { username } = await getSession()
	const { backfillPosts } = await import('../../src/federation/backfill.mjs')
	let checks = 0
	const result = await backfillPosts(username, {
		/**
		 * @returns {boolean} 是否已足够
		 */
		enough: () => {
			checks++
			return true
		},
	})
	assertEquals(result.phase, 'skip')
	assertEquals(checks, 1)
})

Deno.test('backfillPosts in-flight dedupes concurrent calls', async () => {
	const { username } = await getSession()
	const { backfillPosts } = await import('../../src/federation/backfill.mjs')
	let runs = 0
	/**
	 * @returns {Promise<boolean>} 是否已足够
	 */
	const enough = async () => {
		runs++
		await new Promise(resolve => setTimeout(resolve, 30))
		return true
	}
	const [a, b] = await Promise.all([
		backfillPosts(username, { enough }),
		backfillPosts(username, { enough }),
	])
	assertEquals(a.phase, 'skip')
	assertEquals(b.phase, 'skip')
	assertEquals(runs, 1)
})

Deno.test('backfillPosts progresses past following when still empty', async () => {
	const { username, operator } = await getSession()
	const { backfillPosts } = await import('../../src/federation/backfill.mjs')
	const phases = []
	let call = 0
	const result = await backfillPosts(username, {
		viewerEntityHash: operator,
		/**
		 * @returns {boolean} 是否已足够
		 */
		enough: () => {
			call++
			// 第一次入口检查不够；following 后再够，避免打 discover/multihop 网络
			const ok = call > 1
			phases.push(call)
			return ok
		},
	})
	assertEquals(result.phase, 'following')
	assert(phases.length >= 2)
})

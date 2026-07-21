/**
 * dislike / reaction_index / listReactionEvents 集成测试。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const materialize = await import('../../src/timeline/materialize.mjs')
const reactionIndex = await import('../../src/federation/reaction/index.mjs')

const TARGET = placeholderEntityHash('a')
const POST_ID = 'd'.repeat(64)
const REACTOR_B = placeholderEntityHash('b')
const REACTOR_C = placeholderEntityHash('c')

Deno.test('dislike then undislike via reducer', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'dislike',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID },
	}, { fanout: false })
	let view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.dislikes.length, 1)

	await append.commitTimelineEvent(username, operator, {
		type: 'undislike',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID },
	}, { fanout: false })
	view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.dislikes.length, 0)
})

Deno.test('like and dislike are mutually exclusive in materialized view', async () => {
	const { username, operator } = await getSession()
	await append.commitTimelineEvent(username, operator, {
		type: 'like',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID },
	}, { fanout: false })
	let view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.likes.length, 1)
	assertEquals(view.dislikes.length, 0)

	await append.commitTimelineEvent(username, operator, {
		type: 'dislike',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID },
	}, { fanout: false })
	view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.likes.length, 0)
	assertEquals(view.dislikes.length, 1)
})

Deno.test('reaction_index projection after like', async () => {
	const { username, operator } = await getSession()
	const likeEvent = await append.commitTimelineEvent(username, operator, {
		type: 'like',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID },
	}, { fanout: false })

	const summary = await reactionIndex.summarizeReactions(username, TARGET, POST_ID)
	assert(summary.likes.includes(operator.toLowerCase()))
	assert(!summary.dislikes.includes(operator.toLowerCase()))

	const events = await reactionIndex.listReactionEvents(username, TARGET, POST_ID)
	assertEquals(events.length, 1)
	assertEquals(events[0].id, likeEvent.id)
})

Deno.test('listReactionEvents paginates by afterReactor', async () => {
	const { username, operator } = await getSession()
	const reactors = [operator, REACTOR_B, REACTOR_C].map(h => h.toLowerCase()).sort()
	for (const reactor of reactors) 
		await reactionIndex.upsertReaction(username, TARGET, POST_ID, reactor, {
			kind: 'like',
			event: { id: `evt-${reactor}`, type: 'like', content: { targetEntityHash: TARGET, targetPostId: POST_ID } },
		})
	

	const first = await reactionIndex.listReactionEvents(username, TARGET, POST_ID, null, 2)
	assertEquals(first.length, 2)
	assertEquals(first[0].id, `evt-${reactors[0]}`)

	const second = await reactionIndex.listReactionEvents(username, TARGET, POST_ID, reactors[1], 2)
	assertEquals(second.length, 1)
	assertEquals(second[0].id, `evt-${reactors[2]}`)
})

Deno.test('private publishReactions skips reaction_index projection', async () => {
	const { username, operator } = await getSession()
	const tasteStore = await import('../../src/taste/store.mjs')
	await tasteStore.saveTaste(username, operator, {
		...tasteStore.emptyTasteStore(),
		privacy: { publishPreferences: true, publishReactions: false },
	})
	await append.commitTimelineEvent(username, operator, {
		type: 'like',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID },
	}, { fanout: false })
	const summary = await reactionIndex.summarizeReactions(username, TARGET, POST_ID)
	assert(!summary.likes.includes(operator.toLowerCase()))
})

Deno.test('tag_name event materializes into view.tagNames', async () => {
	const { username, operator } = await getSession()
	const tagHash = placeholderEntityHash('t')
	await append.commitTimelineEvent(username, operator, {
		type: 'tag_name',
		content: { tagHash, locale: 'zh-CN', label: '测试标签' },
	}, { fanout: false })
	const view = await materialize.getTimelineMaterialized(username, operator)
	assertEquals(view.tagNames?.[tagHash.toLowerCase()]?.['zh-CN'], '测试标签')
})

Deno.test('normalizeReactionTarget rejects path traversal postId', () => {
	assertEquals(reactionIndex.normalizeReactionTarget(TARGET, '../etc/passwd'), null)
	assertEquals(reactionIndex.normalizeReactionTarget(TARGET, POST_ID)?.postId, POST_ID)
})

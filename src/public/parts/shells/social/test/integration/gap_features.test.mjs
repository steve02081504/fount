/**
 * 关键词屏蔽 / 社区笔记投影 / dwell 信号集成测试。
 */
/* global Deno */
import { placeholderEntityHash } from 'fount/scripts/test/fixtures.mjs'
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { createTestSession } from '../harness.mjs'

const getSession = createTestSession()

const append = await import('../../src/timeline/append.mjs')
const noteIndex = await import('../../src/federation/note_index.mjs')
const mutedKeywords = await import('../../src/mutedKeywords.mjs')
const contentFilter = await import('../../src/lib/contentFilter.mjs')
const feedVisibility = await import('../../src/feedVisibility.mjs')
const dwell = await import('../../src/engagement/dwell.mjs')

const TARGET = placeholderEntityHash('n')
const POST_ID = 'e'.repeat(64)

Deno.test('muted keywords filter canViewPost', async () => {
	const { username, operator } = await getSession()
	await mutedKeywords.replaceMutedKeywords(username, operator, [
		{ pattern: 'bannedword', matchTags: true },
	])
	const muted = await mutedKeywords.loadMutedKeywords(username, operator)
	assertEquals(muted.entries.length, 1)
	assert(contentFilter.postMatchesMutedKeywords({ content: { text: 'has bannedword here' } }, muted))

	const viewerContext = {
		following: new Set(),
		personalFilter: {
			blockedEntityHashes: new Set(),
			blockedSubjects: new Set(),
			hiddenEntityHashes: new Set(),
			hiddenSubjects: new Set(),
		},
		mutedKeywords: muted,
	}
	assertEquals(feedVisibility.canViewPost({
		entityHash: TARGET,
		content: { text: 'has bannedword here', visibility: 'public' },
	}, viewerContext), false)
	assertEquals(feedVisibility.canViewPost({
		entityHash: TARGET,
		content: { text: 'clean post', visibility: 'public' },
	}, viewerContext), true)
})

Deno.test('post_note projects into note_index and tops with helpful votes', async () => {
	const { username, operator } = await getSession()
	const note = await append.commitTimelineEvent(username, operator, {
		type: 'post_note',
		content: { targetEntityHash: TARGET, targetPostId: POST_ID, text: 'context for readers' },
	}, { fanout: false })

	let summary = await noteIndex.summarizeNotes(username, TARGET, POST_ID)
	assertEquals(summary.notes.length, 1)
	assertEquals(summary.topNote, null)

	await append.commitTimelineEvent(username, operator, {
		type: 'note_vote',
		content: {
			targetEntityHash: TARGET,
			targetPostId: POST_ID,
			noteEventId: note.id,
			helpful: true,
		},
	}, { fanout: false })

	summary = await noteIndex.summarizeNotes(username, TARGET, POST_ID)
	assert(summary.topNote)
	assertEquals(summary.topNote.noteEventId, note.id)
	assertEquals(summary.topNote.score, 1)
})

Deno.test('dwell signals accumulate author and tag boosts', async () => {
	const { username, operator } = await getSession()
	const author = placeholderEntityHash('d')
	await dwell.appendDwellSignals(username, operator, [
		{ author, postId: POST_ID, tags: ['cats'], dwellMs: 4500 },
		{ author, postId: POST_ID, tags: ['cats'], dwellMs: 8000 },
		{ author, postId: 'f'.repeat(64), tags: ['dogs'], dwellMs: 1000 },
	])
	const authors = await dwell.loadDwellAuthorBoosts(username, operator)
	assertEquals(authors.get(author.toLowerCase()), dwell.AUTHOR_BOOST_PER_DWELL * 2)
	const tags = await dwell.loadDwellTagBoosts(username, operator)
	assertEquals(tags.get('cats'), dwell.TAG_WEIGHT_PER_DWELL * 2)
	assertEquals(tags.has('dogs'), false)
})

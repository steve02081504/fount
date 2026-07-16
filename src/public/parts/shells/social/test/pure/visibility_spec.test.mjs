/**
 * visibilitySpec / canViewPost / 相册 reducer 纯函数测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { topologicalCanonicalOrder } from 'npm:@steve02081504/fount-p2p/dag/index'

import { canViewPost } from '../../src/feedVisibility.mjs'
import {
	compareVisibilityStrictness,
	isPublicDiscoverable,
	minVisibilitySpec,
	normalizeVisibilitySpec,
	visibilitySpecsEqual,
} from '../../src/lib/visibilitySpec.mjs'
import {
	createSocialTimelineState,
	finalizeSocialTimelineView,
	SOCIAL_TIMELINE_REDUCERS,
} from '../../src/timeline/reducers.mjs'

const AUTHOR = 'a'.repeat(128)
const VIEWER = 'b'.repeat(128)
const OTHER = 'c'.repeat(128)

/**
 * @param {object} overrides 覆盖
 * @returns {object} viewerContext
 */
function ctx(overrides = {}) {
	return {
		viewerEntityHash: VIEWER,
		following: new Set([VIEWER]),
		followSince: new Map(),
		at: Date.now(),
		personalFilter: {
			blockedEntityHashes: new Set(),
			blockedSubjects: new Set(),
			hiddenEntityHashes: new Set(),
			hiddenSubjects: new Set(),
		},
		mutedKeywords: { entries: [] },
		...overrides,
	}
}

Deno.test('normalizeVisibilitySpec expands UI presets', () => {
	const seven = normalizeVisibilitySpec({ visibility: 'followers_7d' })
	assertEquals(seven.visibility, 'followers_since')
	assertEquals(seven.minFollowMs, 7 * 24 * 60 * 60 * 1000)
	const thirty = normalizeVisibilitySpec({ visibility: 'followers_30d' })
	assertEquals(thirty.minFollowMs, 30 * 24 * 60 * 60 * 1000)
})

Deno.test('compareVisibilityStrictness / minVisibilitySpec', () => {
	assertEquals(compareVisibilityStrictness('public', 'followers') < 0, true)
	assertEquals(compareVisibilityStrictness('private', 'selected') > 0, true)
	assertEquals(compareVisibilityStrictness(
		{ visibility: 'followers_since', minFollowMs: 7 * 86400000 },
		{ visibility: 'followers_since', minFollowMs: 30 * 86400000 },
	) < 0, true)
	const min = minVisibilitySpec(['private', 'followers', 'public'])
	assertEquals(min?.visibility, 'public')
})

Deno.test('canViewPost covers new visibility tiers', () => {
	const following = ctx({
		following: new Set([VIEWER, AUTHOR]),
		followSince: new Map([[AUTHOR, Date.now() - 10 * 86400000]]),
	})
	assertEquals(canViewPost({ entityHash: AUTHOR, content: { visibility: 'unlisted' } }, following), true)
	assertEquals(canViewPost({ entityHash: AUTHOR, content: { visibility: 'followers_since', minFollowMs: 7 * 86400000 } }, following), true)
	assertEquals(canViewPost({
		entityHash: AUTHOR,
		content: { visibility: 'followers_since', minFollowMs: 30 * 86400000 },
	}, following), false)
	assertEquals(canViewPost({
		entityHash: AUTHOR,
		content: { visibility: 'selected', allow: [VIEWER] },
	}, following), true)
	assertEquals(canViewPost({
		entityHash: AUTHOR,
		content: { visibility: 'selected', allow: [OTHER] },
	}, following), false)
	assertEquals(canViewPost({ entityHash: AUTHOR, content: { visibility: 'private' } }, following), false)
	assertEquals(canViewPost({ entityHash: AUTHOR, content: { visibility: 'private' } }, ctx({
		viewerEntityHash: AUTHOR,
		following: new Set([AUTHOR]),
	})), true)
	assertEquals(canViewPost({
		entityHash: AUTHOR,
		content: { visibility: 'public', except: [VIEWER] },
	}, following), false)
})

Deno.test('isPublicDiscoverable only public', () => {
	assertEquals(isPublicDiscoverable({ visibility: 'public' }), true)
	assertEquals(isPublicDiscoverable({ visibility: 'unlisted' }), false)
	assertEquals(isPublicDiscoverable({ visibility: 'followers' }), false)
})

Deno.test('visibilitySpecsEqual', () => {
	assertEquals(visibilitySpecsEqual('public', { visibility: 'public' }), true)
	assertEquals(visibilitySpecsEqual(
		{ visibility: 'selected', allow: [OTHER, VIEWER] },
		{ visibility: 'selected', allow: [VIEWER, OTHER] },
	), true)
})

Deno.test('album reducers maintain reverse index and virtual default', () => {
	const events = [
		{ id: 'p1', type: 'post', prev_event_ids: [], hlc: { wall: 1 }, content: { text: 'hi', mediaRefs: [{ kind: 'image' }], visibility: 'public' } },
		{ id: 'p2', type: 'post', prev_event_ids: ['p1'], hlc: { wall: 2 }, content: { text: 'no media', visibility: 'public' } },
		{ id: 'a1', type: 'album_create', prev_event_ids: ['p2'], hlc: { wall: 3 }, content: { albumId: 'vac', name: 'Vacation', visibility: 'followers' } },
		{ id: 'l1', type: 'album_post_add', prev_event_ids: ['a1'], hlc: { wall: 4 }, content: { albumId: 'vac', postId: 'p1' } },
	]
	const order = topologicalCanonicalOrder(events.map(event => ({
		id: event.id,
		prev_event_ids: event.prev_event_ids,
		hlc: event.hlc,
		node_id: 'n',
	})))
	const state = createSocialTimelineState()
	const byId = new Map(events.map(event => [event.id, event]))
	for (const id of order) {
		const event = byId.get(id)
		const reduce = SOCIAL_TIMELINE_REDUCERS[event.type]
		if (reduce) reduce(state, event)
	}
	const view = finalizeSocialTimelineView(state, order)
	assertEquals(view.albums.vac.postIds, ['p1'])
	assertEquals(view.albumsByPost.p1, ['vac'])
	assertEquals(view.albums.default.virtual, true)
	assertEquals(view.albums.default.postIds.includes('p1'), false)
	assertEquals(view.albums.default.postIds.includes('p2'), false)
})

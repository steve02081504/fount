/**
 * Social emoji_pack_upsert / delete reducer 测试。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std/assert/mod.ts'

import { SOCIAL_TIMELINE_EVENT_TYPES } from '../../src/federation/namespace.mjs'
import {
	createSocialTimelineState,
	finalizeSocialTimelineView,
	SOCIAL_TIMELINE_REDUCERS,
} from '../../src/timeline/reducers.mjs'

Deno.test('emoji_pack events registered in types and reducers', () => {
	assertEquals(SOCIAL_TIMELINE_EVENT_TYPES.has('emoji_pack_upsert'), true)
	assertEquals(SOCIAL_TIMELINE_EVENT_TYPES.has('emoji_pack_delete'), true)
	assertEquals(typeof SOCIAL_TIMELINE_REDUCERS.emoji_pack_upsert, 'function')
	assertEquals(typeof SOCIAL_TIMELINE_REDUCERS.emoji_pack_delete, 'function')
})

Deno.test('emoji_pack_upsert and delete fold into view', () => {
	let state = createSocialTimelineState()
	state = SOCIAL_TIMELINE_REDUCERS.emoji_pack_upsert(state, {
		id: 'e1',
		type: 'emoji_pack_upsert',
		content: {
			packId: 'epack_1',
			source: { kind: 'entity', id: 'aa'.repeat(64) },
			localized: { 'en-UK': { name: 'Pack' } },
			items: [{ emojiId: 'e_1', mimeType: 'image/png', contentHash: 'ab'.repeat(32) }],
			visibility: 'followers',
		},
	})
	assertEquals(state.emojiPacks.get('epack_1')?.items?.length, 1)
	state = SOCIAL_TIMELINE_REDUCERS.emoji_pack_delete(state, {
		id: 'e2',
		type: 'emoji_pack_delete',
		content: { packId: 'epack_1' },
	})
	const view = finalizeSocialTimelineView(state, ['e1', 'e2'])
	assertEquals(view.emojiPacks.epack_1, undefined)
})

/**
 * 群预览卡片组装：本地 state → discovery → 联邦 fallback。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { assembleGroupPreviewCard } from '../src/group/groupPreviewCard.mjs'

const GROUP_ID = 'grp_preview_test'

Deno.test('group preview: local materialized state', () => {
	const preview = assembleGroupPreviewCard({
		groupId: GROUP_ID,
		state: {
			groupMeta: { name: 'Local Guild', description: 'from state' },
			groupSettings: { joinPolicy: 'invite-only', discoveryPublic: false },
		},
		memberKey: 'member-key',
	})
	assertEquals(preview.title, 'Local Guild')
	assertEquals(preview.blurb, 'from state')
	assertEquals(preview.isMember, true)
	assertEquals(preview.canJoin, false)
	assertEquals(preview.found, true)
})

Deno.test('group preview: discovery index when no local text', () => {
	const preview = assembleGroupPreviewCard({
		groupId: GROUP_ID,
		discoveryEntry: { title: 'Discovered', blurb: 'via index' },
	})
	assertEquals(preview.title, 'Discovered')
	assertEquals(preview.isMember, false)
	assertEquals(preview.canJoin, false)
	assertEquals(preview.found, true)
})

Deno.test('group preview: federated group card fallback', () => {
	const preview = assembleGroupPreviewCard({
		groupId: GROUP_ID,
		remote: { title: 'Remote Card', blurb: 'from peers' },
	})
	assertEquals(preview.title, 'Remote Card')
	assertEquals(preview.isMember, false)
	assertEquals(preview.canJoin, false)
	assertEquals(preview.found, true)
})

Deno.test('group preview: open policy allows join for non-members', () => {
	const preview = assembleGroupPreviewCard({
		groupId: GROUP_ID,
		state: { groupMeta: { name: 'Open Hub' }, groupSettings: { joinPolicy: 'open' } },
	})
	assertEquals(preview.canJoin, true)
})

/**
 * session_* 不占 tip frontier：建群后 world_bind + 后续联邦设置不得被当成假分叉。
 */
/* global Deno */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { computeDagTipIdsFromEvents } from 'npm:@steve02081504/fount-p2p/governance/branch'

import { computeFederatableDagTipIds, isFederatableDagEvent } from '../../src/chat/dag/eventTypes.mjs'

/**
 * @param {string} label 短标签
 * @returns {string} 64 hex
 */
function hex64(label) {
	const base = label.replace(/[^0-9a-f]/giu, '').toLowerCase() || '0'
	return base.padEnd(64, '0').slice(0, 64)
}

Deno.test('isFederatableDagEvent excludes session_* and agent_reply_frequency_set', () => {
	assertEquals(isFederatableDagEvent({ type: 'session_world_bind' }), false)
	assertEquals(isFederatableDagEvent({ type: 'session_persona_set' }), false)
	assertEquals(isFederatableDagEvent({ type: 'agent_reply_frequency_set' }), false)
	assertEquals(isFederatableDagEvent({ type: 'group_settings_update' }), true)
	assertEquals(isFederatableDagEvent({ type: 'message' }), true)
})

Deno.test('session_world_bind sibling of group_settings_update is not a federatable tip fork', () => {
	// 复现：append 把 session 排除 tip frontier → settings 与 world_bind 同挂 rotate → 全量 tip 看着像双叶分叉
	const rotate = { id: hex64('207a7e'), prev_event_ids: [], type: 'channel_key_rotate_batch' }
	const worldBind = { id: hex64('5e5510'), prev_event_ids: [rotate.id], type: 'session_world_bind' }
	const settings = { id: hex64('5e771'), prev_event_ids: [rotate.id], type: 'group_settings_update' }
	const events = [rotate, worldBind, settings]

	assertEquals(computeDagTipIdsFromEvents(events).sort(), [worldBind.id, settings.id].sort())
	assertEquals(computeFederatableDagTipIds(events), [settings.id])
})

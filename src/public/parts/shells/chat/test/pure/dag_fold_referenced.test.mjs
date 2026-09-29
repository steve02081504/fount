/**
 * 缺陷回归：折叠不得删除仍被保留行引用（或仍为 tip / checkpoint 锚点）的过程事件，
 * 否则引用它的后续治理事件会成为孤儿，物化选支会丢掉分支。
 */
/* global Deno */
import { assertEquals } from 'jsr:@std/assert'
import { computeDagTipIdsFromEvents } from 'npm:@steve02081504/fount-p2p/governance/branch'

import { computeFoldReferencedIds, shouldDropDagEvent } from '../../src/chat/dag/foldPolicy.mjs'

/**
 * @param {string} label 短标签
 * @returns {string} 64 hex
 */
function hex64(label) {
	const base = label.replace(/[^\da-f]/giu, '').toLowerCase() || '0'
	return base.padEnd(64, '0').slice(0, 64)
}

/**
 * 按 foldPolicy 语义模拟一次折叠，返回保留的事件。
 * @param {object[]} rows 事件行
 * @param {{ anchorId?: string | null }} [options] 折叠选项
 * @returns {{ kept: object[], referencedIds: Set<string> }} 保留事件与引用闭包
 */
function simulateFold(rows, options = {}) {
	const tipIds = new Set(computeDagTipIdsFromEvents(rows))
	const referencedIds = computeFoldReferencedIds(rows, {
		archivedMessageIds: new Set(),
		protectedHotIds: new Set(),
		dagFoldAfterArchive: true,
		tipIds,
		anchorId: options.anchorId ?? null,
	})
	const kept = rows.filter(row => !shouldDropDagEvent(
		row, new Set(), new Set(), true, tipIds, referencedIds,
	))
	return { kept, referencedIds }
}

Deno.test('fold keeps a referenced message_edit so its dependent event is not orphaned', () => {
	const genesis = { id: hex64('genesis'), type: 'member_join', prev_event_ids: [] }
	const channel = { id: hex64('channel'), type: 'channel_create', prev_event_ids: [genesis.id], channelId: 'ch' }
	const edit = { id: hex64('edit'), type: 'message_edit', prev_event_ids: [channel.id], channelId: 'ch' }
	const dependent = { id: hex64('dependent'), type: 'channel_delete', prev_event_ids: [edit.id], channelId: 'ch' }
	const rows = [genesis, channel, edit, dependent]

	const { kept, referencedIds } = simulateFold(rows)
	const keptIds = new Set(kept.map(row => row.id))

	assertEquals(referencedIds.has(edit.id), true)
	assertEquals(keptIds.has(edit.id), true)
	assertEquals(keptIds.has(dependent.id), true)
	// 保留行的每个父要么仍在保留集，要么已知被引用（锚点/被折叠），不得成为孤儿。
	for (const row of kept)
		for (const parentId of row.prev_event_ids || [])
			assertEquals(keptIds.has(parentId) || referencedIds.has(parentId), true)
})

Deno.test('fold keeps a process event that is a current tip', () => {
	const genesis = { id: hex64('genesis'), type: 'member_join', prev_event_ids: [] }
	const edit = { id: hex64('edittip'), type: 'message_edit', prev_event_ids: [genesis.id], channelId: 'ch' }
	const tipIds = new Set(computeDagTipIdsFromEvents([genesis, edit]))
	const referencedIds = computeFoldReferencedIds([genesis, edit], {
		archivedMessageIds: new Set(),
		protectedHotIds: new Set(),
		dagFoldAfterArchive: true,
		tipIds,
		anchorId: null,
	})
	assertEquals(shouldDropDagEvent(edit, new Set(), new Set(), true, tipIds, referencedIds), false)
})

Deno.test('fold keeps the checkpoint anchor even without tips or dependents', () => {
	const genesis = { id: hex64('genesis'), type: 'member_join', prev_event_ids: [] }
	const edit = { id: hex64('anchor'), type: 'message_edit', prev_event_ids: [genesis.id], channelId: 'ch' }
	const rows = [genesis, edit]
	const tipIds = new Set(computeDagTipIdsFromEvents(rows))
	const referencedIds = computeFoldReferencedIds(rows, {
		archivedMessageIds: new Set(),
		protectedHotIds: new Set(),
		dagFoldAfterArchive: true,
		tipIds: new Set(),
		anchorId: edit.id,
	})
	assertEquals(referencedIds.has(edit.id), true)
	assertEquals(shouldDropDagEvent(edit, new Set(), new Set(), true, new Set(), referencedIds), false)
})

Deno.test('fold still drops a process event referenced only by an archived message', () => {
	const genesis = { id: hex64('genesis'), type: 'member_join', prev_event_ids: [] }
	const orphanEdit = { id: hex64('orphan'), type: 'message_edit', prev_event_ids: [genesis.id], channelId: 'ch' }
	const archivedMessage = { id: hex64('archived'), type: 'message', prev_event_ids: [orphanEdit.id], channelId: 'ch' }
	const finalMessage = { id: hex64('final'), type: 'message', prev_event_ids: [archivedMessage.id], channelId: 'ch' }
	const rows = [genesis, orphanEdit, archivedMessage, finalMessage]
	const archivedIds = new Set([archivedMessage.id])
	const tipIds = new Set(computeDagTipIdsFromEvents(rows))
	const referencedIds = computeFoldReferencedIds(rows, {
		archivedMessageIds: archivedIds,
		protectedHotIds: new Set(),
		dagFoldAfterArchive: true,
		tipIds,
		anchorId: null,
	})
	// 归档 message 被丢弃且不再上溯其父，故 orphanEdit 不被引用 → 仍可折叠。
	assertEquals(tipIds.has(finalMessage.id), true)
	assertEquals(referencedIds.has(orphanEdit.id), false)
	assertEquals(shouldDropDagEvent(orphanEdit, archivedIds, new Set(), true, tipIds, referencedIds), true)
	assertEquals(shouldDropDagEvent(archivedMessage, archivedIds, new Set(), true, tipIds, referencedIds), true)
	assertEquals(shouldDropDagEvent(finalMessage, archivedIds, new Set(), true, tipIds, referencedIds), false)
})

Deno.test('fold records folded-away parent ids as referenced', () => {
	// 父已不在本地事件集中（曾被折叠）：仍须记入引用集，避免其经 gossip 重新出现时被当作新 fork。
	const missingParent = hex64('missingparent')
	const dependent = { id: hex64('dependent2'), type: 'group_settings_update', prev_event_ids: [missingParent] }
	const referencedIds = computeFoldReferencedIds([dependent], {
		archivedMessageIds: new Set(),
		protectedHotIds: new Set(),
		dagFoldAfterArchive: true,
		tipIds: new Set([dependent.id]),
		anchorId: null,
	})
	assertEquals(referencedIds.has(missingParent), true)
})

/**
 * DAG 过程事件折叠：删除可折叠类型；已归档 message 可选删除。
 */
import { rewriteJsonlKeeping, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { invalidateTopologicalOrderMemo } from 'npm:@steve02081504/fount-p2p/federation/topo_order_memo'
import { computeDagTipIdsFromEvents } from 'npm:@steve02081504/fount-p2p/governance/branch'

import { allProtectedHotEventIds } from '../archive/hotPosts.mjs'
import { archivedMessageIdSet, loadArchiveManifest } from '../archive/index.mjs'
import { archiveSettingsFromGroup } from '../archive/settings.mjs'
import { safeReadJson } from '../lib/fsSafe.mjs'
import { eventsPath, snapshotPath } from '../lib/paths.mjs'

import { isFederatableDagEvent } from './eventTypes.mjs'
import { computeFoldReferencedIds, shouldDropDagEvent } from './foldPolicy.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} hotPosts hot_posts
 * @param {object} groupSettings 群设置
 * @returns {Promise<{ dropped: number, kept: number }>} 统计
 */
export async function foldDagProcessEvents(username, groupId, hotPosts, groupSettings = {}) {
	const settings = archiveSettingsFromGroup(groupSettings)
	const manifest = await loadArchiveManifest(username, groupId)
	const archivedIds = archivedMessageIdSet(manifest)
	const protectedHotIds = allProtectedHotEventIds(hotPosts)
	const path = eventsPath(username, groupId)
	const rows = await readJsonl(path, { sanitize: stripDagEventLocalExtensions })
	const tipIds = new Set(computeDagTipIdsFromEvents(rows.filter(isFederatableDagEvent)))
	const checkpoint = await safeReadJson(snapshotPath(username, groupId))
	const anchorId = checkpoint?.checkpoint_event_id || null
	// 先算「被保留行引用闭包」（含锚点）：仅被引用的可折叠过程事件才保留，
	// 否则其子事件会成为孤儿。rewriteJsonlKeeping 的 sanitize 只影响 keep 入参，
	// 原始行字节仍原样写回。
	const referencedIds = computeFoldReferencedIds(rows, {
		archivedMessageIds: archivedIds,
		protectedHotIds,
		dagFoldAfterArchive: settings.dagFoldAfterArchive,
		tipIds,
		anchorId,
	})
	const { kept, dropped } = await rewriteJsonlKeeping(path, row =>
		!shouldDropDagEvent(row, archivedIds, protectedHotIds, settings.dagFoldAfterArchive, tipIds, referencedIds),
	{ sanitize: stripDagEventLocalExtensions },
	)
	invalidateTopologicalOrderMemo(`${username}:${groupId}`)
	return { dropped, kept }
}

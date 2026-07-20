/**
 * DAG 过程事件折叠：删除可折叠类型；已归档 message 可选删除。
 */
import { rewriteJsonlKeeping } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { invalidateTopologicalOrderMemo } from 'npm:@steve02081504/fount-p2p/federation/topo_order_memo'

import { allProtectedHotEventIds } from '../archive/hotPosts.mjs'
import { archivedMessageIdSet, loadArchiveManifest } from '../archive/index.mjs'
import { archiveSettingsFromGroup } from '../archive/settings.mjs'
import { eventsPath } from '../lib/paths.mjs'

import { shouldDropDagEvent } from './foldPolicy.mjs'

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
	const { kept, dropped } = await rewriteJsonlKeeping(path, row =>
		!shouldDropDagEvent(row, archivedIds, protectedHotIds, settings.dagFoldAfterArchive),
	{ sanitize: stripDagEventLocalExtensions },
	)
	invalidateTopologicalOrderMemo(`${username}:${groupId}`)
	return { dropped, kept }
}

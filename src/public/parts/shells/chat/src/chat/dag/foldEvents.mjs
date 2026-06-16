/**
 * DAG 过程事件折叠：删除可折叠类型；已归档 message 可选删除。
 */
import { rewriteJsonlKeeping } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { invalidateTopologicalOrderMemo } from '../../../../../../../scripts/p2p/topo_order_memo.mjs'
import { allProtectedHotEventIds } from '../archive/hotPosts.mjs'
import { archivedMessageIdSet, loadArchiveManifest } from '../archive/index.mjs'
import { archiveSettingsFromGroup } from '../archive/settings.mjs'
import { sanitizeFederatedEvent } from '../events/wire.mjs'
import { eventsPath } from '../lib/paths.mjs'

/**
 *
 */
export { FOLDABLE_PROCESS_EVENT_TYPES, shouldDropDagEvent } from './foldPolicy.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} hotPosts hot_posts
 * @param {object} groupSettings 群设置
 * @returns {Promise<{ dropped: number, kept: number }>} 统计
 */
export async function foldDagProcessEvents(username, groupId, hotPosts, groupSettings = {}) {
	const { shouldDropDagEvent: shouldDrop } = await import('./foldPolicy.mjs')
	const settings = archiveSettingsFromGroup(groupSettings)
	const manifest = await loadArchiveManifest(username, groupId)
	const archivedIds = archivedMessageIdSet(manifest)
	const protectedHotIds = allProtectedHotEventIds(hotPosts)
	const path = eventsPath(username, groupId)
	const { kept, dropped } = await rewriteJsonlKeeping(path, row =>
		!shouldDrop(row, archivedIds, protectedHotIds, settings.dagFoldAfterArchive),
	{ sanitize: sanitizeFederatedEvent },
	)
	invalidateTopologicalOrderMemo(`${username}:${groupId}`)
	return { dropped, kept }
}

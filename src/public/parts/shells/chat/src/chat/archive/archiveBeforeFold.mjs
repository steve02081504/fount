/**
 * 物化维护：在 DAG 折叠前将非热区帖写入冷归档。
 */
import { readJsonl, rewriteJsonlKeeping } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'
import { messagesPath } from '../lib/paths.mjs'

import { allProtectedHotEventIds } from './hotPosts.mjs'
import { appendPostSnapshotsToArchive, isEventArchivedInManifest, loadArchiveManifest } from './index.mjs'
import { buildPostSnapshotsFromLines } from './postSnapshot.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} state 物化状态
 * @param {object[]} events DAG 事件
 * @param {object} hotPosts checkpoint hot_posts
 * @returns {Promise<{ archived: number }>} 统计
 */
export async function archivePostsBeforeDagFold(username, groupId, state, events, hotPosts) {
	const protectedIds = allProtectedHotEventIds(hotPosts)
	const manifest = await loadArchiveManifest(username, groupId)
	let archived = 0
	for (const channelId of Object.keys(state.channels || {})) {
		const messageEvents = events.filter(ev =>
			ev.type === 'message' && String(ev.channelId || 'default') === channelId,
		)
		const toArchiveIds = messageEvents
			.map(ev => ev.id)
			.filter(id => !protectedIds.has(id) && !isEventArchivedInManifest(manifest, channelId, id))
		if (!toArchiveIds.length) continue
		const want = new Set(toArchiveIds)
		const lines = (await readJsonl(messagesPath(username, groupId, channelId), { sanitize: stripDagEventLocalExtensions }))
			.filter(row => want.has(String(row.eventId).trim()))
		let added = 0
		if (!lines.length) {
			const fromEvents = messageEvents
				.filter(ev => want.has(ev.id))
				.map(ev => ({
					eventId: ev.id,
					type: 'message',
					channelId,
					sender: ev.sender,
					charId: ev.charId,
					timestamp: ev.timestamp,
					hlc: ev.hlc,
					content: ev.content,
				}))
			if (!fromEvents.length) continue
			const snaps = await buildPostSnapshotsFromLines(username, groupId, channelId, fromEvents, state)
			added = await appendPostSnapshotsToArchive(username, groupId, channelId, snaps)
		}
		else {
			const snaps = await buildPostSnapshotsFromLines(username, groupId, channelId, lines, state)
			added = await appendPostSnapshotsToArchive(username, groupId, channelId, snaps)
		}
		archived += added
	}
	return { archived }
}

/**
 * 维护后裁剪 messages.jsonl 仅保留热区行。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} hotPosts hot_posts
 * @returns {Promise<void>} 无返回值
 */
export async function trimMessagesJsonlToHotWindow(username, groupId, hotPosts) {
	const { getState } = await import('../dag/materialize.mjs')
	const { state } = await getState(username, groupId)
	const protectedIds = allProtectedHotEventIds(hotPosts)
	const hotTypes = new Set(['message_edit', 'message_delete', 'message_feedback', 'reaction_add', 'reaction_remove'])
	for (const channelId of Object.keys(state.channels || {})) {
		const path = messagesPath(username, groupId, channelId)
		await rewriteJsonlKeeping(path, row =>
			protectedIds.has(String(row.eventId).trim()) || hotTypes.has(row.type),
		{ sanitize: stripDagEventLocalExtensions })
	}
}

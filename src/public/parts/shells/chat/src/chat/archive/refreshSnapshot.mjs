/**
 * 已冷归档消息的 PostSnapshot 刷新（message_edit 后）。
 */
import { writeFile } from 'node:fs/promises'

import { readJsonlStream } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { findChannelMessageRow } from '../channel/messageMutations.mjs'
import { getState } from '../dag/materialize.mjs'
import { channelArchivePath } from '../lib/paths.mjs'

import { isEventArchivedInManifest, loadArchiveManifest, mutateArchiveManifest } from './index.mjs'
import { canonicalArchiveMonthLine } from './monthDigest.mjs'
import { buildPostSnapshotsFromLines } from './postSnapshot.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} eventId message eventId
 * @param {{ markDeleted?: boolean }} [options] 强制标记 deleted
 * @returns {Promise<boolean>} 是否已更新归档行
 */
export async function refreshArchivedSnapshotIfPresent(username, groupId, channelId, eventId, options = {}) {
	const id = String(eventId || '').trim().toLowerCase()
	if (!id) return false
	const manifest = await loadArchiveManifest(username, groupId)
	if (!isEventArchivedInManifest(manifest, channelId, id)) return false
	const month = manifest.archivedEventIds[channelId]?.[id]
	if (!month) return false

	const { state } = await getState(username, groupId)
	const row = await findChannelMessageRow(username, groupId, channelId, id)
	if (!row && !options.markDeleted) return false
	/** @type {object} */
	const workRow = row || {
		eventId: id,
		type: 'message',
		channelId,
		sender: state.messageSenderIndex?.[id]?.sender || '',
		charId: state.messageSenderIndex?.[id]?.charId || null,
		content: {},
	}
	const edited = state.messageOverlay?.editHistory?.get(id)
	if (edited) workRow.content = edited
	const snaps = await buildPostSnapshotsFromLines(username, groupId, channelId, [workRow], state)
	const snap = snaps[0]
	if (!snap) return false
	if (options.markDeleted) snap.deleted = true

	const path = channelArchivePath(username, groupId, channelId, month)
	/** @type {object[]} */
	const rows = []
	let replaced = false
	for await (const line of readJsonlStream(path)) 
		if (String(line.eventId).trim().toLowerCase() === id) {
			rows.push(snap)
			replaced = true
		}
		else rows.push(line)
	
	if (!replaced) return false
	await writeFile(path, rows.map(row => canonicalArchiveMonthLine(row)).join('\n') + '\n', 'utf8')
	await mutateArchiveManifest(username, groupId, async m => {
		const { refreshManifestMonthDigest } = await import('./monthDigest.mjs')
		await refreshManifestMonthDigest(username, groupId, channelId, month, m)
		return true
	})
	return true
}

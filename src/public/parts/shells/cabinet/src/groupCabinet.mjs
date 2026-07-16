import { randomUUID } from 'node:crypto'

import { getChatClient } from '../../chat/src/api/client.mjs'
import { loadGroupState } from '../../chat/src/api/internal.mjs'
import { appendFileDeleteEvent, appendFileSystemUpdateEvent } from '../../chat/src/chat/dag/channelOperations.mjs'
import { listActiveFilesFromState } from '../../chat/src/chat/files/groupFiles.mjs'
import { canInChannel, resolveActiveMemberKeyForLocalUser } from '../../chat/src/group/access.mjs'
import { PERMISSIONS } from '../../chat/src/permissions/chat.mjs'

import { normalizeEntry, patchEntry } from './entryModel.mjs'

/**
 * @param {object} state 群状态
 * @param {object} meta 文件元数据
 * @param {string} fileId 文件 id
 * @returns {object} 柜条目
 */
function fileMetaToEntry(state, meta, fileId) {
	return normalizeEntry({
		id: fileId,
		name: meta.name || fileId,
		kind: 'file',
		parent_id: meta.folderId ?? null,
		size: meta.size || 0,
		mime_type: meta.mime_type || meta.mimeType || 'application/octet-stream',
		description: meta.description || '',
		created: meta.created || {
			at: meta.uploadedAt || Date.now(),
			entity_hash: meta.uploaderPubKeyHash || meta.created?.entity_hash || '',
		},
		modified: meta.modified || {
			at: meta.uploadedAt || Date.now(),
			entity_hash: meta.uploaderPubKeyHash || '',
		},
		evfs_path: `chat/${fileId}`,
		attrs: {
			hidden: Boolean(meta.attrs?.hidden),
			system: Boolean(meta.attrs?.system),
		},
		preview: meta.preview || { url: '', delete_with_file: true },
	}, meta.uploaderPubKeyHash || '')
}

/**
 * @param {object} state 群状态
 * @returns {object[]} 文件夹条目
 */
function foldersToEntries(state) {
	const folders = state.fileFolders || {}
	return Object.entries(folders).map(([folderId, folder]) => normalizeEntry({
		id: folderId,
		name: folder.name || folderId,
		kind: 'folder',
		parent_id: folder.parentFolderId ?? null,
		mime_type: 'inode/directory',
		description: folder.description || '',
		attrs: folder.attrs || { hidden: false, system: false },
		created: folder.created,
		modified: folder.modified,
	}, folder.created?.entity_hash || ''))
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @returns {Promise<{ state: object, member: object | null, can_write: boolean, can_manage: boolean }>} 上下文
 */
async function groupContext(username, entityHash, cabinet) {
	const client = await getChatClient(username, entityHash)
	const state = await loadGroupState({ username, entityHash }, cabinet.group_id)
	const memberKey = await resolveActiveMemberKeyForLocalUser(username, cabinet.group_id, state)
	const member = memberKey ? state.members[memberKey] : null
	const channelId = Object.keys(state.channels || {})[0] || 'default'
	const canWrite = Boolean(member && canInChannel(state, member, PERMISSIONS.UPLOAD_FILES, channelId))
	const canManage = Boolean(member && canInChannel(state, member, PERMISSIONS.MANAGE_FILES, channelId))
	return { state, member, can_write: canWrite, can_manage: canManage, channel_id: channelId, client }
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @param {{ parent_id?: string | null, show_hidden?: boolean }} options 选项
 * @returns {Promise<object>} 列表结果
 */
export async function listGroupCabinetEntries(username, entityHash, cabinet, options = {}) {
	const ctx = await groupContext(username, entityHash, cabinet)
	const files = listActiveFilesFromState(ctx.state).map(row => {
		const meta = ctx.state.messageOverlay?.fileIndex?.get?.(row.fileId)
			|| ctx.state.messageOverlay?.fileIndex?.[row.fileId]
			|| row
		return fileMetaToEntry(ctx.state, { ...row, ...meta }, row.fileId)
	})
	const folders = foldersToEntries(ctx.state)
	const all = [...folders, ...files]
	const parentId = options.parent_id == null || options.parent_id === '' ? null : String(options.parent_id)
	const entries = all
		.filter(entry => (entry.parent_id ?? null) === parentId)
		.filter(entry => options.show_hidden || !entry.attrs?.hidden)
		.sort((a, b) => {
			if (a.kind === 'folder' && b.kind !== 'folder') return -1
			if (a.kind !== 'folder' && b.kind === 'folder') return 1
			return String(a.name).localeCompare(String(b.name))
		})
	return {
		cabinet: {
			...cabinet,
			permissions: { can_write: ctx.can_write, can_manage: ctx.can_manage },
		},
		parent_id: parentId,
		entries,
	}
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @param {object} draft 草稿
 * @returns {Promise<object>} 条目
 */
export async function registerGroupCabinetEntry(username, entityHash, cabinet, draft) {
	const ctx = await groupContext(username, entityHash, cabinet)
	if (!ctx.can_write) throw new Error('no permission')
	if (draft.kind === 'folder') {
		const folderId = draft.id || randomUUID()
		await appendFileSystemUpdateEvent(username, cabinet.group_id, {
			operation: 'create',
			folderId,
			name: draft.name || folderId,
			parentFolderId: draft.parent_id ?? null,
		})
		return normalizeEntry({
			id: folderId,
			kind: 'folder',
			name: draft.name || folderId,
			parent_id: draft.parent_id ?? null,
			mime_type: 'inode/directory',
			description: draft.description || '',
		}, entityHash)
	}
	// 文件登记由前端走群 chunks/files 上传后在此登记元数据扩展；若已有 file_id 则仅返回映射
	if (!draft.id && !draft.file_id) throw new Error('group file upload must use group chunk API first')
	const fileId = String(draft.id || draft.file_id)
	return normalizeEntry({
		...draft,
		id: fileId,
		kind: 'file',
		evfs_path: `chat/${fileId}`,
	}, entityHash)
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @param {string} entryId 条目
 * @param {object} patch 补丁
 * @returns {Promise<object>} 条目
 */
export async function updateGroupCabinetEntry(username, entityHash, cabinet, entryId, patch) {
	const ctx = await groupContext(username, entityHash, cabinet)
	if (!ctx.can_write && !ctx.can_manage) throw new Error('no permission')
	const folder = ctx.state.fileFolders?.[entryId]
	if (folder) {
		if (patch.name != null)
			await appendFileSystemUpdateEvent(username, cabinet.group_id, {
				operation: 'rename',
				folderId: entryId,
				name: patch.name,
			})
		if (patch.parent_id !== undefined)
			await appendFileSystemUpdateEvent(username, cabinet.group_id, {
				operation: 'move',
				folderId: entryId,
				parentFolderId: patch.parent_id ?? null,
			})
		return normalizeEntry({
			id: entryId,
			kind: 'folder',
			name: patch.name || folder.name,
			parent_id: patch.parent_id !== undefined ? patch.parent_id : folder.parentFolderId,
			mime_type: 'inode/directory',
			description: patch.description || folder.description || '',
		}, entityHash)
	}
	const meta = ctx.state.messageOverlay?.fileIndex?.get?.(entryId)
		|| ctx.state.messageOverlay?.fileIndex?.[entryId]
	if (!meta) throw new Error('entry not found')
	// 元数据扩展字段（description/attrs/preview）需通过后续 file_system_update 或专用事件；当前先返回 patch 视图
	return patchEntry(fileMetaToEntry(ctx.state, meta, entryId), patch, entityHash)
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @param {object} cabinet 柜
 * @param {string[]} entryIds 条目
 * @returns {Promise<{ deleted: string[] }>} 结果
 */
export async function deleteGroupCabinetEntries(username, entityHash, cabinet, entryIds) {
	const ctx = await groupContext(username, entityHash, cabinet)
	if (!ctx.can_manage && !ctx.can_write) throw new Error('no permission')
	const deleted = []
	for (const id of entryIds) {
		if (ctx.state.fileFolders?.[id]) {
			await appendFileSystemUpdateEvent(username, cabinet.group_id, {
				operation: 'delete',
				folderId: id,
			})
			deleted.push(id)
			continue
		}
		await appendFileDeleteEvent(username, cabinet.group_id, id)
		deleted.push(id)
	}
	return { deleted }
}

/**
 * 将已加入的群枚举为共享柜行。
 * @param {string} username 用户
 * @param {string} entityHash 实体
 * @returns {Promise<object[]>} 群柜列表
 */
export async function listJoinedGroupCabinets(username, entityHash) {
	const { enumerateJoinedFederatedGroups } = await import('../../chat/src/group/queries.mjs')
	const rows = await enumerateJoinedFederatedGroups(username, entityHash)
	return rows.map(row => ({
		cabinet_id: `group:${row.groupId}`,
		name: row.name || row.groupId.slice(0, 8),
		type: 'group',
		group_id: row.groupId,
		visibility: { visibility: 'private' },
		created_at: row.createdAt || 0,
	}))
}

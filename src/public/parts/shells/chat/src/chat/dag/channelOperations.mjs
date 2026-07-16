/**
 * 【文件】`dag/channelOperations.mjs` — 频道与附属 DAG 写操作封装。
 * 【职责】通过 `appendSignedLocalEvent` 发出频道 CRUD、列表项、置顶、文件、反应、`file_master_key_rotate` 等治理/内容事件。
 * 【原理】高层 API 构造事件体与时间戳，签名与鉴权委托 `append.mjs`；流媒体会话仅更新进程内 `streamingState` 不落 DAG。
 * 【数据结构】各函数返回签名后的完整 DAG 事件对象；`file_master_key_rotate` 在 DM 或 ADMIN/MANAGE_ROLES 下允许。
 * 【关联】`append.mjs`、`localSigner.mjs`、`materialize.mjs`、`streamingState.mjs`。
 */
import { randomUUID } from 'node:crypto'

import { governanceChannelId } from '../../group/access.mjs'

import { appendEvent, appendSignedLocalEvent } from './append.mjs'
import { memberChannelPermissions } from './groupMaterializedState.mjs'
import { resolveLocalEventSigner } from './localSigner.mjs'
import { getState } from './materialize.mjs'
import { setStreamingSession } from './streamingState.mjs'

/**
 * 通过 `channel_create` 事件创建频道。
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} options 频道参数
 * @returns {Promise<object>} 签名事件
 */
export async function createChannel(username, groupId, options) {
	const channelId = options.channelId || randomUUID()
	const created = await appendSignedLocalEvent(username, groupId, {
		type: 'channel_create',
		timestamp: Date.now(),
		content: {
			channelId,
			type: options.type || 'text',
			name: options.name || channelId,
			description: options.description,
			parentChannelId: options.parentChannelId,
			parentEventId: options.parentEventId || null,
			syncScope: options.syncScope || 'group',
			isPrivate: !!options.isPrivate,
			subRoomId: options.subRoomId,
			manualItems: options.manualItems,
		},
	})
	const { appendChannelKeyRotate } = await import('../channel_keys/schedule.mjs')
	await appendChannelKeyRotate(username, groupId, channelId)
	return created
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 目标频道 ID
 * @param {object} [patch] 变更字段
 * @returns {Promise<object>} 签名事件
 */
export async function updateChannel(username, groupId, channelId, patch = {}) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'channel_update',
		timestamp: Date.now(),
		content: { ...patch, channelId },
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 待删除频道 ID
 * @returns {Promise<object>} 签名事件
 */
export async function deleteChannel(username, groupId, channelId) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'channel_delete',
		timestamp: Date.now(),
		content: { channelId },
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 列表频道 ID
 * @param {Array<{ title?: string, description?: string, targetChannelId?: string, url?: string }>} items 展示项
 * @returns {Promise<object>} 签名事件
 */
export async function appendListItemUpdate(username, groupId, channelId, items) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'list_item_update',
		timestamp: Date.now(),
		channelId,
		content: { channelId, items },
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 流媒体频道 ID
 * @param {{ sessionId: string, expiresAt: number }} session 会话元数据
 * @param {string} [entityHash] 归因实体；缺省为 operator
 * @returns {Promise<{ ok: boolean }>} 写入成功标记
 */
export async function appendStreamingSession(username, groupId, channelId, session, entityHash) {
	const { sender } = await resolveLocalEventSigner(username, groupId, entityHash)
	setStreamingSession(groupId, channelId, {
		sessionId: session.sessionId,
		expiresAt: session.expiresAt,
		by: sender,
	})
	return { ok: true }
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 被置顶消息的事件 ID
 * @returns {Promise<object>} 签名事件
 */
export async function appendPinEvent(username, groupId, channelId, targetEventId) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'pin_message',
		channelId,
		timestamp: Date.now(),
		content: { channelId, targetId: targetEventId },
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} channelId 频道 ID
 * @param {string} targetEventId 被取消置顶的消息事件 ID
 * @returns {Promise<object>} 签名事件
 */
export async function appendUnpinEvent(username, groupId, channelId, targetEventId) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'unpin_message',
		channelId,
		timestamp: Date.now(),
		content: { channelId, targetId: targetEventId },
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ key_generation: number, new_key_nonce: string }} body 轮换参数
 * @returns {Promise<object>} 签名事件
 */
export async function appendKeyRotateEvent(username, groupId, body) {
	const { key_generation, new_key_nonce } = body
	if (!Number.isFinite(key_generation) || key_generation < 0)
		throw new Error('key_generation (non-negative integer) required')
	if (!new_key_nonce?.trim())
		throw new Error('new_key_nonce required')
	const { sender, secretKey } = await resolveLocalEventSigner(username, groupId)
	const { state } = await getState(username, groupId)
	const permissionsChannelId = governanceChannelId(state)
	const perms = memberChannelPermissions(state, sender, permissionsChannelId)
	const activeCount = Object.values(state.members).filter(member => member?.status === 'active').length
	const isDmPair = activeCount === 2
	if (!isDmPair && !perms.ADMIN && !perms.MANAGE_ROLES)
		throw new Error('file_master_key_rotate requires ADMIN, MANAGE_ROLES, or DM membership')
	return appendEvent(username, groupId, {
		type: 'file_master_key_rotate',
		sender,
		timestamp: Date.now(),
		content: { key_generation: Math.floor(key_generation), new_key_nonce: new_key_nonce.trim() },
	}, secretKey)
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {object} meta 文件元数据
 * @returns {Promise<object>} 签名事件
 */
export async function appendFileUploadEvent(username, groupId, meta) {
	const fileId = meta.fileId || randomUUID()
	const content = {
		fileId,
		name: meta.name,
		size: meta.size,
		mimeType: meta.mimeType,
		folderId: meta.folderId,
		ceMode: meta.ceMode || 'convergent',
	}
	content.contentHash = meta.contentHash
	if (Array.isArray(meta.parts) && meta.parts.length)
		content.parts = meta.parts
	else {
		content.ciphertextHash = meta.ciphertextHash
		content.wrappedKey = meta.wrappedKey
		content.storageLocator = meta.storageLocator
	}
	if (Number.isFinite(meta.key_generation))
		content.key_generation = Math.floor(meta.key_generation)
	if (meta.description != null) content.description = String(meta.description).slice(0, 4000)
	if (meta.attrs) content.attrs = meta.attrs
	if (meta.preview) content.preview = meta.preview
	if (meta.created) content.created = meta.created
	if (meta.modified) content.modified = meta.modified
	if (meta.mime_type && !content.mimeType) content.mimeType = meta.mime_type
	return appendSignedLocalEvent(username, groupId, {
		type: 'file_upload',
		timestamp: Date.now(),
		content,
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {string} fileId 文件 ID
 * @returns {Promise<object>} 签名事件
 */
export async function appendFileDeleteEvent(username, groupId, fileId) {
	return appendSignedLocalEvent(username, groupId, {
		type: 'file_delete',
		timestamp: Date.now(),
		content: { fileId },
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ operation: 'create'|'rename'|'move'|'delete', folderId: string, name?: string, parentFolderId?: string | null }} spec 操作说明
 * @returns {Promise<object>} 签名事件
 */
export async function appendFileSystemUpdateEvent(username, groupId, spec) {
	const folderId = String(spec.folderId || '').trim()
	if (!folderId) throw new Error('folderId required')
	const {operation} = spec
	if (!['create', 'rename', 'move', 'delete'].includes(operation))
		throw new Error('invalid file_system_update operation')
	const content = { operation, folderId }
	if (operation === 'create' || operation === 'rename')
		content.name = String(spec.name || folderId).trim() || folderId
	if (operation === 'create' || operation === 'move')
		content.parentFolderId = spec.parentFolderId ?? null
	return appendSignedLocalEvent(username, groupId, {
		type: 'file_system_update',
		timestamp: Date.now(),
		content,
	})
}

/**
 * @param {string} username 用户名
 * @param {string} groupId 群组 ID
 * @param {{ type: 'reaction_add'|'reaction_remove', channelId: string, targetEventId: string, emoji: string, targetPubKeyHash?: string }} options 反应参数
 * @returns {Promise<object>} 签名事件
 */
export async function appendReactionEvent(username, groupId, options) {
	const { type, channelId = 'default', targetEventId, emoji, targetPubKeyHash } = options
	if (!targetEventId || !emoji) throw new Error('targetEventId and emoji required')
	const content = { targetId: targetEventId, emoji }
	if (type === 'reaction_remove' && targetPubKeyHash)
		content.targetPubKeyHash = targetPubKeyHash
	return appendSignedLocalEvent(username, groupId, {
		type,
		channelId,
		timestamp: Date.now(),
		content,
	})
}

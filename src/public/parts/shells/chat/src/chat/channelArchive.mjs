/**
 * 【文件】channelArchive.mjs
 * 【职责】频道完整归档（portable JSON）的导出与导入：含冷热历史、编辑终态、删除墓碑、反应计数、附件元数据。
 * 【原理】导出扫 messages.jsonl + cold archive（含 deleted），折叠 overlay；导入在目标群新建 text 频道，以 bridge/backfill 重签写入，不触发自动回复。
 * 【数据结构】见 channelArchiveFormat.mjs。
 * 【关联】channelArchiveFormat、dag/queries、archive/reader、postSnapshot、messageCommit、channelOperations、messageMutations。
 */
import { randomUUID } from 'node:crypto'

import { readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { stripDagEventLocalExtensions } from 'npm:@steve02081504/fount-p2p/dag/strip_extensions'

import {
	channelMessageContentObject,
	textChannelContent,
} from '../../public/shared/channelContent.mjs'
import { mergeChannelMessagesForDisplay } from '../../public/shared/messageMerge.mjs'

import { listArchiveMonthsForChannel } from './archive/index.mjs'
import {
	buildPostSnapshotFromRow,
	reactionsForMessage,
} from './archive/postSnapshot.mjs'
import { readArchiveMonth } from './archive/reader.mjs'
import { commitChannelMessageEvent } from './channel/messageCommit.mjs'
import { appendChannelMessageDelete } from './channel/messageMutations.mjs'
import { decryptEventContent } from './channel_keys/content.mjs'
import {
	CHANNEL_ARCHIVE_FORMAT,
	CHANNEL_ARCHIVE_VERSION,
	portableMessageFromSnapshot,
	reactionCountsFromList,
	validateChannelArchive,
} from './channelArchiveFormat.mjs'
import { createChannel, appendPinEvent } from './dag/channelOperations.mjs'
import { resolveLocalEventSigner } from './dag/localSigner.mjs'
import { getState } from './dag/materialize.mjs'
import { messagesPath } from './lib/paths.mjs'
import { getOperatorEntityHash } from './lib/replica.mjs'

/**
 *
 */
export {
	CHANNEL_ARCHIVE_FORMAT,
	CHANNEL_ARCHIVE_VERSION,
	portableMessageFromSnapshot,
	reactionCountsFromList,
	validateChannelArchive,
}

/**
 * @param {object} a 消息
 * @param {object} b 消息
 * @returns {number} 排序比较
 */
function compareArchiveMessages(a, b) {
	const wa = Number(a.hlc?.wall ?? a.timestamp ?? 0)
	const wb = Number(b.hlc?.wall ?? b.timestamp ?? 0)
	if (wa !== wb) return wa - wb
	return String(a.sourceEventId || '').localeCompare(String(b.sourceEventId || ''))
}

/**
 * @param {object} overlay messageOverlay
 * @param {string} eventId 消息 id
 * @returns {Record<string, number>} emoji → count
 */
function reactionCountsFromOverlay(overlay, eventId) {
	return reactionCountsFromList(reactionsForMessage(overlay, eventId))
}

/**
 * @param {object} state 物化状态
 * @param {string[]} fileIds 附件 id
 * @returns {Array<{ name: string, mimeType: string, size: number }>} 附件元数据
 */
function attachmentMetaFromFileIds(state, fileIds) {
	if (!Array.isArray(fileIds) || !fileIds.length) return []
	const index = state.messageOverlay?.fileIndex
	/** @type {Array<{ name: string, mimeType: string, size: number }>} */
	const out = []
	for (const fileId of fileIds) {
		const meta = index instanceof Map ? index.get(fileId) : index?.[fileId]
		if (!meta) {
			out.push({ name: String(fileId), mimeType: 'application/octet-stream', size: 0 })
			continue
		}
		out.push({
			name: String(meta.name || fileId),
			mimeType: String(meta.mime_type || meta.mimeType || 'application/octet-stream'),
			size: Number(meta.size) || 0,
		})
	}
	return out
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} row 合并后的 message 行
 * @param {object} state 物化状态
 * @param {{ deleted?: boolean, wasEdited?: boolean }} [flags] 标记
 * @returns {Promise<object>} portable 消息
 */
async function portableFromHotRow(username, groupId, channelId, row, state, flags = {}) {
	let content = row.content
	let decryptView = row.decryptView
	if (!decryptView?.failed && content) {
		const result = await decryptEventContent(username, groupId, channelId, content)
		if (result.ok && result.content?.type)
			content = result.content
		else {
			content = null
			decryptView = {
				failed: true,
				...result.generation != null ? { pendingGeneration: result.generation } : {},
			}
		}
	}
	const snap = await buildPostSnapshotFromRow({
		...row,
		channelId,
		content,
		decryptView,
	}, state, username, groupId)
	const portable = portableMessageFromSnapshot({
		...snap,
		deleted: flags.deleted ?? snap.deleted,
	})
	portable.wasEdited = !!flags.wasEdited || !!row.wasEdited
	portable.attachments = attachmentMetaFromFileIds(
		state,
		Array.isArray(content?.fileIds) ? content.fileIds : [],
	)
	portable.reactionCounts = reactionCountsFromOverlay(state.messageOverlay, String(row.eventId).trim())
	if (row.extension?.feedback)
		portable.feedback = row.extension.feedback
	return portable
}

/**
 * 导出频道完整归档 JSON。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<object>} 归档对象
 */
export async function exportChannelArchive(username, groupId, channelId) {
	const { state } = await getState(username, groupId)
	const channel = state.channels?.[channelId]
	if (!channel) throw new Error('Channel not found')

	/** @type {Map<string, object>} */
	const byId = new Map()

	const months = await listArchiveMonthsForChannel(username, groupId, channelId)
	for (const month of months) {
		const snaps = await readArchiveMonth(username, groupId, channelId, month)
		for (const snap of snaps) {
			const id = String(snap.eventId || '').trim()
			if (!id) continue
			const portable = portableMessageFromSnapshot(snap)
			portable.attachments = attachmentMetaFromFileIds(
				state,
				Array.isArray(snap.content?.fileIds) ? snap.content.fileIds : [],
			)
			byId.set(id, portable)
		}
	}

	const hotLines = await readJsonl(messagesPath(username, groupId, channelId), {
		sanitize: stripDagEventLocalExtensions,
	})
	const deletedIds = new Set(
		[...state.messageOverlay?.deletedIds || []].map(id => String(id).trim()),
	)
	const merged = mergeChannelMessagesForDisplay(hotLines)
	for (const row of merged) {
		if (row.type !== 'message') continue
		const id = String(row.eventId || '').trim()
		if (!id) continue
		byId.set(id, await portableFromHotRow(username, groupId, channelId, row, state, {
			wasEdited: !!row.wasEdited,
		}))
	}

	for (const deletedId of deletedIds) {
		if (byId.has(deletedId)) {
			byId.get(deletedId).deleted = true
			continue
		}
		const orig = hotLines.find(row =>
			row.type === 'message' && String(row.eventId).trim() === deletedId,
		)
		if (!orig) continue
		byId.set(deletedId, await portableFromHotRow(username, groupId, channelId, orig, state, {
			deleted: true,
		}))
	}

	const pins = state.messageOverlay?.pins
	const pinList = pins instanceof Map
		? pins.get(channelId) || []
		: pins?.[channelId] || []
	for (const pinId of pinList) {
		const row = byId.get(String(pinId).trim())
		if (row) row.pinned = true
	}

	const messages = [...byId.values()].sort(compareArchiveMessages)
	return {
		format: CHANNEL_ARCHIVE_FORMAT,
		version: CHANNEL_ARCHIVE_VERSION,
		exportedAt: new Date().toISOString(),
		source: {
			groupId,
			channelId,
			channelName: String(channel.name || channelId),
			channelDescription: String(channel.description || ''),
		},
		messages,
	}
}

/**
 * @param {object} msg portable 消息
 * @param {object} source 归档 source
 * @param {{ signerEntityHash?: string | null, signerPubKeyHash?: string | null }} [signer] 导入重签者
 * @returns {object} 写入 content
 */
function buildImportContent(msg, source, signer = {}) {
	const displayName = String(msg.display?.name || '').trim() || '?'
	const displayAvatar = msg.display?.avatar ? String(msg.display.avatar).trim() : null
	const base = msg.content && typeof msg.content === 'object' && msg.content.type
		? channelMessageContentObject(msg.content)
		: textChannelContent(typeof msg.content === 'string' ? msg.content : '')

	const {
		fileIds: _dropIds,
		fileCount: _dropCount,
		fileAlts: _dropAlts,
		sessionSnapshot: _dropSnap,
		chatLogEntryId: _dropEntry,
		...rest
	} = base

	const sourceSenderPubKeyHash = msg.sourceSenderPubKeyHash
		? String(msg.sourceSenderPubKeyHash).trim().toLowerCase()
		: null
	const sourceEntityHash = msg.sourceEntityHash
		? String(msg.sourceEntityHash).trim().toLowerCase()
		: null
	const importedFrom = {
		groupId: source.groupId,
		channelId: source.channelId,
		eventId: msg.sourceEventId,
		...source.channelName ? { channelName: source.channelName } : {},
		...sourceSenderPubKeyHash ? { sourceSenderPubKeyHash } : {},
		...sourceEntityHash ? { sourceEntityHash } : {},
		...signer.signerEntityHash ? { signerEntityHash: String(signer.signerEntityHash).toLowerCase() } : {},
		...signer.signerPubKeyHash ? { signerPubKeyHash: String(signer.signerPubKeyHash).toLowerCase() } : {},
		attributionMismatch: true,
	}

	return channelMessageContentObject({
		...rest,
		displayName,
		...displayAvatar ? { displayAvatar } : {},
		importedFrom,
		...Object.keys(msg.reactionCounts || {}).length
			? { importedReactions: msg.reactionCounts }
			: {},
		...Array.isArray(msg.attachments) && msg.attachments.length
			? { importedAttachments: msg.attachments }
			: {},
	})
}

/**
 * 将频道归档导入为当前群的新 text 频道。
 * @param {string} username replica
 * @param {string} groupId 目标群 ID
 * @param {object} archive 归档 JSON
 * @param {{ name?: string, description?: string }} [options] 频道名覆盖
 * @returns {Promise<{ channelId: string, messageCount: number }>} 新频道与写入条数
 */
export async function importChannelArchive(username, groupId, archive, options = {}) {
	const data = validateChannelArchive(archive)
	const source = data.source && typeof data.source === 'object' ? data.source : {}
	const baseName = String(options.name || source.channelName || 'imported').trim() || 'imported'
	const description = options.description != null
		? String(options.description)
		: String(source.channelDescription || '')

	const { state } = await getState(username, groupId)
	const existingNames = new Set(
		Object.values(state.channels || {}).map(ch => String(ch?.name || '').trim().toLowerCase()),
	)
	let channelName = baseName
	if (existingNames.has(channelName.toLowerCase())) {
		const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
		channelName = `${baseName} (${stamp})`
	}

	const channelId = `imported_${randomUUID().slice(0, 12)}`
	await createChannel(username, groupId, {
		channelId,
		type: 'text',
		name: channelName,
		description,
	})

	const signerEntityHash = await getOperatorEntityHash(username)
	const signer = await resolveLocalEventSigner(username, groupId, signerEntityHash || undefined)
	const signerPubKeyHash = signer?.sender ? String(signer.sender).toLowerCase() : null
	const signerInfo = {
		...signerEntityHash ? { signerEntityHash } : {},
		...signerPubKeyHash ? { signerPubKeyHash } : {},
	}

	let messageCount = 0
	for (const msg of data.messages) {
		if (!msg || typeof msg !== 'object') continue
		if (msg.decryptView?.failed && !msg.content) {
			const tombstone = textChannelContent('[decrypt failed]', {
				displayName: String(msg.display?.name || '?'),
				...msg.display?.avatar ? { displayAvatar: msg.display.avatar } : {},
				importedFrom: {
					groupId: source.groupId,
					channelId: source.channelId,
					eventId: msg.sourceEventId,
					decryptFailed: true,
					attributionMismatch: true,
					...signerInfo,
					...msg.sourceSenderPubKeyHash
						? { sourceSenderPubKeyHash: String(msg.sourceSenderPubKeyHash).toLowerCase() }
						: {},
					...msg.sourceEntityHash
						? { sourceEntityHash: String(msg.sourceEntityHash).toLowerCase() }
						: {},
				},
			})
			const event = await commitChannelMessageEvent({
				username,
				groupId,
				channelId,
				content: tombstone,
				timestamp: Number(msg.timestamp) || Date.now(),
				origin: 'bridge',
				skipWorldHook: true,
				ingress: 'backfill',
			})
			if (msg.deleted && event?.id)
				await appendChannelMessageDelete(username, groupId, channelId, event.id)
			messageCount++
			continue
		}

		const content = buildImportContent(msg, source, signerInfo)
		const event = await commitChannelMessageEvent({
			username,
			groupId,
			channelId,
			content,
			timestamp: Number(msg.timestamp) || Date.now(),
			origin: 'bridge',
			skipWorldHook: true,
			ingress: 'backfill',
		})
		if (!event?.id) continue
		messageCount++
		if (msg.deleted)
			await appendChannelMessageDelete(username, groupId, channelId, event.id)
		else if (msg.pinned)
			await appendPinEvent(username, groupId, channelId, event.id)
	}

	return { channelId, messageCount }
}

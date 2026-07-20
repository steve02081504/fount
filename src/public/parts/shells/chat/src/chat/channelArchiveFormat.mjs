/**
 * 【文件】channelArchiveFormat.mjs
 * 【职责】频道归档 JSON 的纯格式：常量、校验、反应计数折叠、PostSnapshot → portable。
 * 【原理】无 I/O；供 channelArchive 与 pure 测试共用。
 */
import { channelMessageContentObject } from '../../public/shared/channelContent.mjs'

/** @type {string} */
export const CHANNEL_ARCHIVE_FORMAT = 'fount-channel-archive'

/**
 * @param {object[]} reactions PostSnapshot 形反应列表
 * @returns {Record<string, number>} emoji → count
 */
export function reactionCountsFromList(reactions) {
	/** @type {Record<string, number>} */
	const out = {}
	for (const row of reactions || []) {
		const emoji = String(row?.emoji || '').trim()
		if (!emoji) continue
		const count = Array.isArray(row.voters) ? row.voters.length : Number(row.count) || 0
		if (count > 0) out[emoji] = count
	}
	return out
}

/**
 * @param {object} snap PostSnapshot
 * @returns {object} portable 消息
 */
export function portableMessageFromSnapshot(snap) {
	const content = snap.content && typeof snap.content === 'object'
		? channelMessageContentObject(snap.content)
		: snap.content ?? null
	const fileIds = Array.isArray(content?.fileIds) ? content.fileIds : []
	const sender = snap.sender ? String(snap.sender).trim().toLowerCase() : null
	const sourceEntityHash = snap.sourceEntityHash
		? String(snap.sourceEntityHash).trim().toLowerCase()
		: null
	return {
		sourceEventId: String(snap.eventId).trim(),
		timestamp: snap.timestamp ?? null,
		hlc: snap.hlc ?? null,
		charId: snap.charId ?? null,
		...sender ? { sourceSenderPubKeyHash: sender } : {},
		...sourceEntityHash ? { sourceEntityHash } : {},
		display: {
			name: String(snap.display?.name || '').trim() || '?',
			avatar: snap.display?.avatar ?? null,
		},
		content,
		...snap.decryptView ? { decryptView: snap.decryptView } : {},
		deleted: !!snap.deleted,
		wasEdited: false,
		pinned: !!snap.pinned,
		reactionCounts: reactionCountsFromList(snap.reactions),
		attachments: fileIds.length
			? fileIds.map(id => ({ name: String(id), mimeType: 'application/octet-stream', size: 0 }))
			: [],
	}
}

/**
 * @param {object} archive 待校验对象
 * @returns {object} 规范化归档
 */
export function validateChannelArchive(archive) {
	if (!archive || typeof archive !== 'object')
		throw new Error('Invalid channel archive')
	if (archive.format !== CHANNEL_ARCHIVE_FORMAT)
		throw new Error(`Unsupported archive format: ${archive.format}`)
	if (!Array.isArray(archive.messages))
		throw new Error('Archive messages must be an array')
	return archive
}

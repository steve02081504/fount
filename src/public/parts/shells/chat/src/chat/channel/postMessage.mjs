/**
 * 【文件】channel/postMessage.mjs
 * 【职责】频道 human 发帖：persona BeforeUserSend、附件上传、规范化 content、经 messageCommit 落 DAG。
 * 【原理】postChannelMessage 为 human（Hub/CLI）唯一入口；BeforeUserSend 在落盘前改写/拒绝；world AddChatLogEntry 由 commitChannelMessageEvent 触发。
 * 【数据结构】uploadMeta { fileId, parts[], contentHash, wrappedKey }；message content 经 channelContent 规范化。
 * 【关联】messageCommit、files/groupFiles、file_keys/store、dag/append、lib/channelContent、achievements。
 */
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { FEDERATION_CHUNK_MAX_BYTES } from 'npm:@steve02081504/fount-p2p/core/constants'
import { putFileManifest } from 'npm:@steve02081504/fount-p2p/files/evfs'
import { parseEvfsRef } from 'npm:@steve02081504/fount-p2p/files/evfs_ref'
import { entityFileUrl } from '../../entity/filesUrl.mjs'
import { unlockAchievement } from '../../../../achievements/src/api.mjs'
import {
	channelMessageAgentText,
	channelMessageContentObject,
	channelMessageShowText,
	textChannelContent,
} from '../../../public/shared/channelContent.mjs'
import { appendFileUploadEvent } from '../dag/channelOps.mjs'
import { getCurrentFileMasterKey } from '../file_keys/store.mjs'
import { putEncryptedChunk, syncGroupFileManifest } from '../files/groupFiles.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'
import { getMaterializedSession } from '../session/dagSession.mjs'
import { loadPlayerForReplica } from '../session/timeSliceParts.mjs'

import { commitChannelMessageEvent } from './messageCommit.mjs'

/**
 * 上传单个明文文件到群 DAG（`file_upload` + 可选 Hub 内联图附件 hash）。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {Buffer} buffer 文件字节
 * @param {{ name?: string, mime_type?: string }} file 元数据
 * @returns {Promise<{ fileId: string, uploadMeta: object, inlineImageUrl: string | null }>} 上传结果
 */
async function uploadPlainFileToGroup(username, groupId, buffer, file) {
	const fileId = randomUUID()
	const name = String(file.name || 'file').slice(0, 255)
	const mimeType = String(file.mime_type || 'application/octet-stream')
	const contentHash = createHash('sha256').update(buffer).digest('hex')
	const keyEntry = await getCurrentFileMasterKey(username, groupId)
	const keyGen = keyEntry?.generation
	const partCount = Math.max(1, Math.ceil(buffer.byteLength / FEDERATION_CHUNK_MAX_BYTES))
	/** @type {object[]} */
	const parts = []

	for (let partIndex = 0; partIndex < partCount; partIndex++) {
		const off = partIndex * FEDERATION_CHUNK_MAX_BYTES
		const slice = buffer.subarray(off, Math.min(off + FEDERATION_CHUNK_MAX_BYTES, buffer.byteLength))
		const partFileId = partCount === 1 ? fileId : `${fileId}:${partIndex}`
		const chunk = await putEncryptedChunk(username, groupId, {
			fileId: partFileId,
			data: slice,
			keyGeneration: keyGen,
		})
		parts.push({
			index: partIndex,
			partSize: slice.byteLength,
			contentHash: chunk.contentHash,
			ciphertextHash: chunk.ciphertextHash,
			wrappedKey: chunk.wrappedKey,
			storageLocator: chunk.storageLocator,
			key_generation: chunk.key_generation,
		})
	}

	/** @type {object} */
	const uploadMeta = {
		fileId,
		name,
		size: buffer.byteLength,
		mimeType,
		contentHash,
		key_generation: keyGen,
	}
	if (partCount === 1) {
		const p = parts[0]
		uploadMeta.ciphertextHash = p.ciphertextHash
		uploadMeta.wrappedKey = p.wrappedKey
		uploadMeta.storageLocator = p.storageLocator
	}
	else {
		uploadMeta.parts = parts
		uploadMeta.key_generation = parts[0]?.key_generation
	}

	await appendFileUploadEvent(username, groupId, uploadMeta)
	await syncGroupFileManifest(username, groupId, uploadMeta).catch(error => {
		console.error('[evfs] syncGroupFileManifest failed', error)
	})

	let inlineImageUrl = null
	if (mimeType.startsWith('image/')) {
		const operatorEntityHash = await resolveOperatorEntityHash(username)
		if (operatorEntityHash) {
			const attachId = randomUUID()
			const logicalPath = `shells/chat/attachments/${attachId}`
			await putFileManifest({
				ownerEntityHash: operatorEntityHash,
				logicalPath,
				plaintext: buffer,
				name,
				mimeType,
				ceMode: 'convergent',
			})
			inlineImageUrl = entityFileUrl(operatorEntityHash, logicalPath)
		}
	}

	return { fileId, uploadMeta, inlineImageUrl }
}

/**
 * @param {string} stickerBase64 贴纸 base64 或 data URL
 * @returns {number} 近似明文字节数
 */
function approxStickerBytes(stickerBase64) {
	const rawLen = stickerBase64.startsWith('data:')
		? (stickerBase64.split(',')[1] || '').length
		: stickerBase64.length
	return Math.ceil(rawLen * 0.75)
}

/**
 * 规范化频道消息内容（贴纸大小、群邀请字段等）。
 * @param {object} content 消息内容对象
 * @param {number} maxBytes `maxDagPayloadBytes` 上限
 * @returns {object} 规范化后的内容
 */
function normalizeChannelMessageContent(content, maxBytes) {
	const normalized = channelMessageContentObject(content)
	if (normalized.type === 'sticker') {
		const emojiRef = String(normalized.emojiRef || '').trim()
		if (emojiRef && /:\[[\w.-]+\/[\w.-]+\](?!:)/.test(emojiRef))
			return {
				type: 'sticker',
				emojiRef,
				stickerId: String(normalized.stickerId || ''),
				stickerName: String(normalized.stickerName || ''),
			}
		const stickerBase64 = String(normalized.stickerBase64 || '')
		if (stickerBase64 && approxStickerBytes(stickerBase64) > maxBytes)
			throw new Error(`sticker exceeds maxDagPayloadBytes (~${maxBytes})`)
		return normalized
	}
	if (normalized.type === 'group_invite') {
		if (!normalized.groupId) throw new Error('group_invite requires groupId')
		return {
			type: 'group_invite',
			groupId: normalized.groupId,
			inviteCode: normalized.inviteCode || '',
			groupName: (normalized.groupName || '').slice(0, 100),
			description: (normalized.description ?? '').slice(0, 200),
			...normalized.memberCount != null && {
				memberCount: Math.max(0, Math.floor(normalized.memberCount)),
			},
		}
	}
	return normalized
}

/**
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} content 规范化后 content
 * @param {Array<{ name?: string, mime_type?: string, buffer: Buffer }> | undefined} files 附件
 * @returns {Promise<{ content: object, files: Array<{ name?: string, mime_type?: string, buffer: Buffer }> | undefined }>} 改写结果
 */
async function applyBeforeUserSend(username, groupId, channelId, content, files) {
	// 按发送者 replica 解析 persona（勿用 getActiveGroupRuntime：联邦仿真里槽位可能属于别的 replica）
	const session = await getMaterializedSession(username, groupId)
	const { player, player_id: personaname } = await loadPlayerForReplica(username, session.personas)
	const beforeSend = player.interfaces.chat.BeforeUserSend
	if (!beforeSend) return { content, files }

	const memberId = await resolveOperatorEntityHash(username) || ''
	const result = await beforeSend({
		groupId,
		channelId,
		username,
		personaname,
		memberId,
		input: content,
		files,
	})
	if (!result) return { content, files }
	if (result.reject)
		throw httpError(400, String(result.reject))
	return {
		content: result.input != null ? channelMessageContentObject(result.input) : content,
		files: result.files !== undefined ? result.files : files,
	}
}

/**
 * 向频道发送 human 消息：BeforeUserSend → 附件 → messageCommit。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{
 *   text?: string,
 *   rawContent?: object,
 *   files?: Array<{ name?: string, mime_type?: string, buffer: Buffer }>,
 *   reply?: { content: unknown, isAutoTrigger?: boolean },
 *   maxDagPayloadBytes?: number,
 * }} payload 消息载荷
 * @returns {Promise<{ event: object, fileIds: string[] }>} DAG 消息事件
 */
export async function postChannelMessage(username, groupId, channelId, payload = {}) {
	const maxBytes = Number(payload.maxDagPayloadBytes) || 262_144

	let content = payload.rawContent
		? channelMessageContentObject(payload.rawContent)
		: textChannelContent(payload.text ?? '')

	if (payload.reply) {
		content = channelMessageContentObject(payload.reply.content)
		if (payload.reply.isAutoTrigger) content = { ...content, isAutoTrigger: true }
	}

	let files = Array.isArray(payload.files) ? payload.files : undefined
	;({ content, files } = await applyBeforeUserSend(username, groupId, channelId, content, files))

	const fileIds = []
	const inlineMarkers = []
	for (const file of files || []) {
		if (parseEvfsRef(file.buffer))
			continue
		const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer, 'base64')
		if (!buffer.byteLength) continue
		const { fileId, inlineImageUrl } = await uploadPlainFileToGroup(username, groupId, buffer, file)
		fileIds.push(fileId)
		if (inlineImageUrl) {
			const fileName = String(file.name || 'image').replace(/\|/g, '_')
			inlineMarkers.push(`[image:${fileName}|${inlineImageUrl}]`)
		}
	}

	if (inlineMarkers.length) {
		const isText = content.type === 'text'
		const baseText = isText ? channelMessageAgentText(content) : channelMessageShowText(content)
		const { type, content: previousText, content_for_show, content_for_edit, ...extra } = channelMessageContentObject(content)
		content = textChannelContent([baseText, ...inlineMarkers].filter(Boolean).join('\n'), {
			...extra,
			...isText && { content_for_show, content_for_edit },
		})
	}

	if (fileIds.length)
		content = { ...content, fileIds, fileCount: fileIds.length }

	content = normalizeChannelMessageContent(content, maxBytes)

	void unlockAchievement(username, 'shells/chat', 'first_chat')
	if ((files || []).some(file => String(file.mime_type || '').startsWith('image/')))
		void unlockAchievement(username, 'shells/chat', 'photo_chat')

	const event = await commitChannelMessageEvent({
		username,
		groupId,
		channelId,
		content: channelMessageContentObject(content),
		origin: 'human',
	})

	void maybeDispatchMailboxForOfflinePeer(username, groupId, event)
		.catch(error => console.error('mailbox: offline peer dispatch failed', error))

	return { event, fileIds }
}

/**
 * DM 对端不在联邦 roster 时经 Mailbox 转发已签名消息。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {object} signedEvent 已签名 message 事件
 * @returns {Promise<void>}
 */
async function maybeDispatchMailboxForOfflinePeer(username, groupId, signedEvent) {
	const { getState } = await import('../dag/materialize.mjs')
	const { state } = await getState(username, groupId)
	const meta = state.groupMeta
	if (meta.dmKind !== 'ecdh') return
	const peerPub = String(meta.dmPeerPubKeyHex || '').trim().toLowerCase()
	if (!peerPub) return
	const { listFederationPeersForGroup } = await import('../federation/index.mjs')
	const { peers } = await listFederationPeersForGroup(username, groupId)
	if (peers.length > 0) return
	const { dispatchMailboxMessage } = await import('../mailbox/ingest.mjs')
	await dispatchMailboxMessage(username, signedEvent, peerPub, {
		groupId,
		channelId: signedEvent.channelId || 'default',
		dmSessionTag: meta.dmSessionTag,
	})
}

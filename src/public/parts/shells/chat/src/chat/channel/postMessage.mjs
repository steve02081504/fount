/**
 * 【文件】channel/postMessage.mjs
 * 【职责】频道发帖：可选 persona BeforeUserSend、附件上传、规范化 content、经 messageCommit 落 DAG。
 * 【原理】postChannelMessage 支持 origin 分流；human 走 BeforeUserSend；char/system 跳过；附件管线与钩子解耦。
 * 【数据结构】uploadMeta { fileId, parts[], contentHash, wrappedKey }；message content 经 channelContent 规范化。
 * 【关联】messageCommit、files/groupFiles、file_keys/store、dag/append、lib/channelContent、achievements。
 */
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'

import { FEDERATION_CHUNK_MAX_BYTES } from 'npm:@steve02081504/fount-p2p/core/constants'
import { parseEvfsRef } from 'npm:@steve02081504/fount-p2p/files/evfs_ref'

import { httpError } from '../../../../../../../scripts/http_error.mjs'
import { assertNotRootChannel } from '../dag/groupSettings.mjs'
import { unlockAchievement } from '../../../../achievements/src/api.mjs'
import {
	channelMessage,
	normalizeChannelMessage,
} from '../../../public/shared/channelContent.mjs'
import { ensureChatExtension, sanitizeAlt } from '../../../public/shared/messageFields.mjs'
import { appendFileUploadEvent } from '../dag/channelOperations.mjs'
import { getCurrentFileMasterKey } from '../file_keys/store.mjs'
import { putEncryptedChunk, syncGroupFileManifest } from '../files/groupFiles.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'
import { getMaterializedSession } from '../session/dagSession.mjs'
import { loadPlayerForReplica } from '../session/timeSliceParts.mjs'

import { commitChannelMessageEvent } from './messageCommit.mjs'

/**
 * 上传附件缓冲规范化：已是 Buffer 原样；string 按 base64；其余交给 Buffer.from。
 * @param {Buffer | string | Uint8Array | ArrayBuffer} buffer 原始缓冲
 * @returns {Buffer} Node Buffer
 */
export function asUploadBuffer(buffer) {
	if (Buffer.isBuffer(buffer)) return buffer
	if (typeof buffer === 'string') return Buffer.from(buffer, 'base64')
	return Buffer.from(buffer)
}

/**
 * 上传单个明文文件到群 DAG（`file_upload` + 群 EVFS manifest）。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {Buffer} buffer 文件字节
 * @param {{ name?: string, mime_type?: string, description?: string }} file 元数据
 * @returns {Promise<{ fileId: string, uploadMeta: object }>} 上传结果
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

	const description = sanitizeAlt(file.description)

	/** @type {object} */
	const uploadMeta = {
		fileId,
		name,
		size: buffer.byteLength,
		mimeType,
		contentHash,
		key_generation: keyGen,
		...description ? { description } : {},
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

	return { fileId, uploadMeta }
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
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} content 规范化后 content
 * @param {Array<{ name?: string, mime_type?: string, buffer: Buffer }> | undefined} files 附件
 * @returns {Promise<{ content: object, files: Array<{ name?: string, mime_type?: string, buffer: Buffer }> | undefined }>} 改写结果
 */
async function applyBeforeUserSend(username, groupId, channelId, content, files) {
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
		content: result.input != null ? normalizeChannelMessage(result.input) : content,
		files: result.files !== undefined ? result.files : files,
	}
}

/**
 * 规范化附件 wire 描述符（fileId / name / mime / size / description）。
 * @param {object} file 已落盘或待上传文件描述符
 * @returns {object} wire files[] 项
 */
function wireFileDescriptor(file) {
	const description = sanitizeAlt(file.description)
	return {
		fileId: file.fileId || '',
		name: String(file.name || 'file').slice(0, 255),
		mime_type: String(file.mime_type || 'application/octet-stream'),
		size: Math.max(0, Number(file.size) || 0),
		...description ? { description } : {},
	}
}

/**
 * 附件上传 + content 规范化（与 human 钩子解耦）。
 * 已有 `fileId` 的描述符（编辑保留项）直接并入，不重新上传。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {object} content 消息内容
 * @param {Array<{ name?: string, mime_type?: string, buffer?: Buffer | string, fileId?: string, size?: number, description?: string }> | undefined} files 附件
 * @param {number} maxBytes payload 上限
 * @param {{ mergeExistingFiles?: boolean }} [options] mergeExistingFiles：与 content.files 合并而非替换
 * @returns {Promise<{ content: object, fileIds: string[] }>} 合并后 content 与 fileIds
 */
export async function attachFilesToContent(username, groupId, content, files, maxBytes, {
	mergeExistingFiles = false,
} = {}) {
	const fileIds = []
	/** @type {object[]} */
	const fileDescriptors = mergeExistingFiles && Array.isArray(content?.files)
		? content.files.map(wireFileDescriptor).filter(file => file.fileId)
		: []
	for (const file of fileDescriptors)
		fileIds.push(file.fileId)

	for (const file of files || []) {
		const existingId = file.fileId || ''
		if (existingId && !file.buffer) {
			if (fileDescriptors.some(d => d.fileId === existingId)) continue
			fileDescriptors.push(wireFileDescriptor(file))
			fileIds.push(existingId)
			continue
		}
		if (parseEvfsRef(file.buffer))
			continue
		const buffer = asUploadBuffer(file.buffer)
		if (!buffer.byteLength) continue
		const { fileId, uploadMeta } = await uploadPlainFileToGroup(username, groupId, buffer, file)
		fileIds.push(fileId)
		fileDescriptors.push(wireFileDescriptor({
			fileId,
			name: uploadMeta.name,
			mime_type: uploadMeta.mimeType,
			size: uploadMeta.size,
			description: file.description,
		}))
	}

	const stickerBase64 = content?.type === 'sticker' ? content.stickerBase64 || '' : ''
	if (stickerBase64 && approxStickerBytes(stickerBase64) > maxBytes)
		throw new Error(`sticker exceeds maxDagPayloadBytes (~${maxBytes})`)

	if (fileDescriptors.length)
		content = normalizeChannelMessage({ ...content, files: fileDescriptors })
	else {
		const cleaned = { ...content }
		delete cleaned.files
		content = normalizeChannelMessage(cleaned)
	}

	return { content, fileIds }
}

/**
 * 向频道发送消息：可选 BeforeUserSend → 附件 → messageCommit。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {{
 *   text?: string,
 *   rawContent?: object,
 *   files?: Array<{ name?: string, mime_type?: string, buffer: Buffer }>,
 *   generated?: { content: unknown, isAutoTrigger?: boolean },
 *   maxDagPayloadBytes?: number,
 *   origin?: 'human' | 'char' | 'system',
 *   charId?: string | null,
 *   entityHash?: string,
 * }} payload 消息载荷
 * @returns {Promise<{ event: object, fileIds: string[] }>} DAG 消息事件
 */
export async function postChannelMessage(username, groupId, channelId, payload = {}) {
	assertNotRootChannel(channelId)
	const maxBytes = Number(payload.maxDagPayloadBytes) || 262_144
	const origin = payload.origin || 'human'

	let content = payload.rawContent
		? normalizeChannelMessage(payload.rawContent)
		: channelMessage(payload.text ?? '')

	if (payload.generated) {
		const generated = payload.generated.content
		content = generated?.type || generated?.content != null
			? normalizeChannelMessage(generated)
			: channelMessage(generated ?? '')
		if (payload.generated.isAutoTrigger)
			ensureChatExtension(content).isAutoTrigger = true
	}

	let files = Array.isArray(payload.files) ? payload.files : undefined
	if (origin === 'human')
		({ content, files } = await applyBeforeUserSend(username, groupId, channelId, content, files))

	const { content: finalized, fileIds } = await attachFilesToContent(username, groupId, content, files, maxBytes)
	content = finalized

	const { canonicalizeMessageContentEmojis } = await import('../../emojiAltText.mjs')
	content = await canonicalizeMessageContentEmojis(username, content)

	if (origin === 'human') {
		void unlockAchievement(username, 'shells/chat', 'first_chat')
		if ((files || []).some(file => (file.mime_type || '').startsWith('image/')))
			void unlockAchievement(username, 'shells/chat', 'photo_chat')
	}

	const event = await commitChannelMessageEvent({
		username,
		groupId,
		channelId,
		content: normalizeChannelMessage(content),
		origin,
		charId: payload.charId ?? null,
		...payload.entityHash && { entityHash: payload.entityHash },
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
	const peerPub = meta.dmPeerPubKeyHex || ''
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

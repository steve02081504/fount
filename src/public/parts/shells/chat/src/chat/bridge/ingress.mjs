import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'

import { FEDERATION_CHUNK_MAX_BYTES } from 'npm:@steve02081504/fount-p2p/core/constants'
import { putFileManifest } from 'npm:@steve02081504/fount-p2p/files/evfs'
import { entityFileUrl } from '../../entity/filesUrl.mjs'
import { getProfile } from '../../entity/profile.mjs'

import {
	channelMessageAgentText,
	channelMessageContentObject,
	textChannelContent,
} from '../../../public/shared/channelContent.mjs'
import { commitChannelMessageEvent } from '../channel/messageCommit.mjs'
import { appendChannelMessageDelete, appendChannelMessageEdit } from '../channel/messageMutations.mjs'
import { appendFileUploadEvent } from '../dag/channelOperations.mjs'
import { getCurrentFileMasterKey } from '../file_keys/store.mjs'
import { putEncryptedChunk, syncGroupFileManifest } from '../files/groupFiles.mjs'
import { resolveOperatorEntityHash } from '../lib/replica.mjs'

import { isBoundBridgeIdentity, resolveBridgeIdentity } from './identity.mjs'
import {
	ensureBridgeGroup,
	lookupBridgeEventId,
	recordBridgeMessagePair,
	resolveBridgeChannel,
} from './registry.mjs'

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {Buffer} buffer 文件字节
 * @param {{ name?: string, mime_type?: string }} file 元数据
 * @returns {Promise<{ fileId: string, inlineImageUrl: string | null }>} 上传结果
 */
async function uploadBridgeFile(username, groupId, buffer, file) {
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
	await syncGroupFileManifest(username, groupId, uploadMeta).catch(console.error)

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

	return { fileId, inlineImageUrl }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} text 正文
 * @param {Array<{ name?: string, mime_type?: string, buffer: Buffer }> | undefined} files 附件
 * @returns {Promise<object>} canonical content
 */
async function buildBridgeMessageContent(username, groupId, text, files) {
	let content = textChannelContent(String(text || ''))
	const fileIds = []
	const inlineMarkers = []
	for (const file of files || []) {
		const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer)
		if (!buffer.byteLength) continue
		const { fileId, inlineImageUrl } = await uploadBridgeFile(username, groupId, buffer, file)
		fileIds.push(fileId)
		if (inlineImageUrl) {
			const fileName = String(file.name || 'image').replace(/\|/g, '_')
			inlineMarkers.push(`[image:${fileName}|${inlineImageUrl}]`)
		}
	}
	if (inlineMarkers.length) {
		const baseText = channelMessageAgentText(content)
		content = textChannelContent([baseText, ...inlineMarkers].filter(Boolean).join('\n'))
	}
	if (fileIds.length)
		content = { ...content, fileIds, fileCount: fileIds.length }
	return channelMessageContentObject(content)
}

/**
 * 已绑定实体作者用 profile 覆盖展示名与头像，DTO 作兜底。
 * @param {string} username replica
 * @param {string} platform 平台名
 * @param {object} dto 桥接 DTO
 * @param {string} groupId 群 ID
 * @param {string} authorEntityHash 作者 entityHash
 * @param {object} content 消息 content
 * @returns {Promise<object>} 展示字段已 enrich 的 content
 */
async function enrichBoundAuthorDisplay(username, platform, dto, groupId, authorEntityHash, content) {
	if (!isBoundBridgeIdentity(username, platform, dto.author.platformUserId)) return content

	const dtoDisplayName = String(dto.author.displayName || '').trim()
	let displayName = dtoDisplayName || `User_${dto.author.platformUserId}`
	let displayAvatar = dto.author.avatarUrl

	const profile = await getProfile(authorEntityHash, username, { groupId })
	if (profile?.name) displayName = String(profile.name).trim() || displayName
	if (profile?.avatar) displayAvatar = profile.avatar

	return {
		...content,
		displayName,
		...displayAvatar ? { displayAvatar } : {},
	}
}

/**
 * 入站桥接消息 → DAG。
 * @param {string} username replica
 * @param {object} dto 桥接 DTO
 * @returns {Promise<object>} 已签名 message 事件
 */
export async function postBridgeMessage(username, dto) {
	const platform = String(dto.platform || '').trim()
	const platformChatId = dto.platformChatId
	if (!platform || platformChatId == null) throw new Error('platform and platformChatId required')

	const chatKind = dto.chatKind === 'dm' ? 'dm' : 'group'
	await ensureBridgeGroup(username, {
		platform,
		platformChatId,
		chatKind,
		name: dto.chatName,
		botname: dto.botname,
	})
	const { groupId, channelId } = await resolveBridgeChannel(username, {
		platform,
		platformChatId,
		platformThreadId: dto.platformThreadId,
	})

	const authorEntityHash = await resolveBridgeIdentity(
		username,
		platform,
		dto.author.platformUserId,
		dto.author.displayName,
	)

	let content = await buildBridgeMessageContent(username, groupId, dto.text, dto.files)
	const replyToEventId = dto.replyToPlatformMessageId != null
		? lookupBridgeEventId(username, groupId, dto.replyToPlatformMessageId)
		: null
	content = {
		...content,
		displayName: String(dto.author.displayName || '').trim() || `User_${dto.author.platformUserId}`,
		...dto.author.avatarUrl ? { displayAvatar: dto.author.avatarUrl } : {},
		extension: {
			bridge: {
				platform,
				platformChatId: String(platformChatId),
				platformMessageId: String(dto.platformMessageId),
				platformUserId: String(dto.author.platformUserId),
				authorEntityHash,
				authorDisplayName: String(dto.author.displayName || '').trim(),
				...dto.platformThreadId != null ? { platformThreadId: String(dto.platformThreadId) } : {},
				...dto.replyToPlatformMessageId != null
					? { replyToPlatformMessageId: String(dto.replyToPlatformMessageId) }
					: {},
				...replyToEventId ? { replyToEventId } : {},
			},
		},
	}
	content = await enrichBoundAuthorDisplay(username, platform, dto, groupId, authorEntityHash, content)

	const event = await commitChannelMessageEvent({
		username,
		groupId,
		channelId,
		content,
		timestamp: dto.timestamp ? Number(dto.timestamp) : Date.now(),
		origin: 'bridge',
		skipWorldHook: true,
		...dto.ingress === 'backfill' ? { ingress: 'backfill' } : {},
	})

	if (event?.id)
		await recordBridgeMessagePair(username, groupId, {
			eventId: event.id,
			platformMessageId: dto.platformMessageId,
		})

	return event
}

/**
 * 入站桥接编辑 → message_edit。
 * @param {string} username replica
 * @param {object} dto 桥接编辑 DTO
 * @returns {Promise<object>} message_edit 事件
 */
export async function postBridgeEdit(username, dto) {
	const platform = String(dto.platform || '').trim()
	const platformChatId = dto.platformChatId
	if (!platform || platformChatId == null) throw new Error('platform and platformChatId required')

	const { groupId, channelId } = await resolveBridgeChannel(username, {
		platform,
		platformChatId,
		platformThreadId: dto.platformThreadId,
	})

	const eventId = lookupBridgeEventId(username, groupId, dto.platformMessageId)
	if (!eventId) throw new Error('bridge message not found for edit')

	const authorEntityHash = await resolveBridgeIdentity(
		username,
		platform,
		dto.author.platformUserId,
		dto.author.displayName,
	)

	let newContent = await buildBridgeMessageContent(username, groupId, dto.text, dto.files)
	newContent = {
		...newContent,
		displayName: String(dto.author.displayName || '').trim() || `User_${dto.author.platformUserId}`,
		...dto.author.avatarUrl ? { displayAvatar: dto.author.avatarUrl } : {},
		extension: {
			bridge: {
				platform,
				platformChatId: String(platformChatId),
				platformMessageId: String(dto.platformMessageId),
				platformUserId: String(dto.author.platformUserId),
				authorEntityHash,
				authorDisplayName: String(dto.author.displayName || '').trim(),
			},
		},
	}
	newContent = await enrichBoundAuthorDisplay(username, platform, dto, groupId, authorEntityHash, newContent)

	return appendChannelMessageEdit(username, groupId, channelId, eventId, newContent)
}

/**
 * 入站桥接删除 → message_delete。
 * @param {string} username replica
 * @param {object} dto 桥接删除 DTO
 * @returns {Promise<object>} message_delete 事件
 */
export async function postBridgeDelete(username, dto) {
	const platform = String(dto.platform || '').trim()
	const platformChatId = dto.platformChatId
	if (!platform || platformChatId == null) throw new Error('platform and platformChatId required')

	const { groupId, channelId } = await resolveBridgeChannel(username, {
		platform,
		platformChatId,
		platformThreadId: dto.platformThreadId,
	})

	const eventId = lookupBridgeEventId(username, groupId, dto.platformMessageId)
	if (!eventId) throw new Error('bridge message not found for delete')

	return appendChannelMessageDelete(username, groupId, channelId, eventId)
}

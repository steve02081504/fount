/**
 * 【文件】`dag/chatLogMirror.mjs` — 内存 chatLog 与 DAG 双向镜像。
 * 【职责】将用户/角色聊天条目同步为 `message`/`message_edit`/`message_delete` 事件；支持流式占位与终稿编辑链。
 * 【原理】非流式与 greeting 经 `commitChannelMessageEvent` 落盘（world AddChatLogEntry pre-DAG）；流式占位 skipWorldHook 后由 finalize 再钩；终稿 `message_edit`；超大正文转 `content_ref`；`extension.dagEventId` 关联 chatLog 与 DAG。
 * 【数据结构】canonical DAG `content`：全员 displayName/displayAvatar；生成类另附 chatLogEntryId、sessionSnapshot；亦可 `content_ref`。
 * 【关联】`../channel/messageCommit.mjs`、`append.mjs`、`lifecycle.mjs`、`hydration.mjs`、`../session/sessionSnapshot.mjs`。
 */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

import { channelMessageAgentText, textChannelContent } from '../../../public/shared/channelContent.mjs'
import { commitChannelMessageEvent } from '../channel/messageCommit.mjs'
import { replicateChunkToFederation } from '../federation/chunks.mjs'
import { resolveGroupChannelId } from '../lib/channelId.mjs'
import { isExpectedTeardownRace } from '../lib/expectedTeardownRace.mjs'
import { getStorageForGroup } from '../storage.mjs'


import { appendSignedLocalEvent } from './append.mjs'
import { ensureGroup } from './lifecycle.mjs'
import { resolveLocalEventSigner } from './localSigner.mjs'
import { getState } from './materialize.mjs'

/**
 * @param {object} entry 聊天条目（chatLog 行：顶层 `content` 字符串）
 * @returns {string} 写入 DAG 的 agent 正文
 */
function entryContentToMirrorText(entry) {
	const { content } = entry
	if (typeof content === 'string') return content
	return channelMessageAgentText(content) || ''
}

/**
 * @param {string} username 所有者
 * @param {string} groupId 群组 ID
 * @param {string} text 完整正文
 * @returns {Promise<object>} content_ref
 */
async function storeContentRef(username, groupId, text) {
	const buffer = Buffer.from(text, 'utf8')
	const hash = createHash('sha256').update(buffer).digest('hex')
	const { state } = await getState(username, groupId)
	const storage = getStorageForGroup(username, state.groupSettings, { groupId })
	const { storageLocator } = await storage.putChunk(groupId, hash, buffer)
	if (storage.storagePeerId === 'federation_swarm')
		void replicateChunkToFederation(username, groupId, hash, buffer).catch(() => { })
	return {
		contentHash: hash,
		alg: 'sha256',
		byteLength: buffer.byteLength,
		storageLocator,
	}
}

/**
 * @param {object} entry 聊天条目
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @returns {Promise<{ channelIdForDag: string, sender: string, timestamp: number, charId?: string }>} 镜像上下文
 */
async function resolveMirrorContext(entry, username, groupId) {
	await ensureGroup(username, groupId)
	let timestamp = entry.time_stamp ? +new Date(entry.time_stamp) : Date.now()
	if (!Number.isFinite(timestamp)) timestamp = Date.now()
	const { sender } = await resolveLocalEventSigner(username, groupId)
	const charId = entry.role === 'char'
		? entry.extension.timeSlice?.charname || entry.name || null
		: null
	const groupChannelId = entry.extension?.groupChannelId
	const channelIdForDag = await resolveGroupChannelId(username, groupId, groupChannelId)
	return {
		channelIdForDag,
		sender,
		timestamp,
		charId,
	}
}

/**
 * §6.4 / §13：流式开始 — DAG `message` 占位（`is_generating: true`）。
 * @param {string} groupId 聊天 ID
 * @param {object} entry 占位条目（须已有 `id`）
 * @param {string} username 所有者
 * @returns {Promise<string | null>} DAG 事件 id
 */
export async function appendDagGeneratingPlaceholder(groupId, entry, username) {
	try {
		if (!username || !entry?.id) return null
		if (entry.extension.timeSlice?.greeting_type) return null
		const { channelIdForDag, timestamp, charId } = await resolveMirrorContext(entry, username, groupId)
		const event = await commitChannelMessageEvent({
			username,
			groupId,
			channelId: channelIdForDag,
			timestamp,
			charId,
			entry,
			origin: 'char',
			skipWorldHook: true,
			content: {
				type: 'text',
				content: '',
				role: entry.role || 'char',
				is_generating: true,
				charId,
			},
		})
		if (event?.id) return event.id
	}
	catch (error) {
		console.error('appendDagGeneratingPlaceholder failed:', error)
	}
	return null
}

/**
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {object} entry 聊天条目
 * @param {string} text 终稿正文
 * @param {string} sender 事件发件人 pubKeyHash
 * @returns {Promise<object>} newContent 载荷
 */
async function buildFinalMessageContent(username, groupId, entry, text, sender) {
	const { state } = await getState(username, groupId)
	const maxBytes = Number(state.groupSettings?.maxDagPayloadBytes) || 262_144
	const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
	const content = {
		chatLogEntryId: entry.id,
		role: entry.role,
		is_generating: false,
	}
	if (entry.role === 'char')
		content.charOwner = sender
	const agent = String(text ?? entryContentToMirrorText(entry))
	const show = entry.content_for_show ?? agent
	const edit = entry.content_for_edit ?? agent
	if (Buffer.byteLength(agent, 'utf8') > maxBytes)
		Object.assign(content, textChannelContent('', {
			content_ref: await storeContentRef(username, groupId, agent),
		}))
	else {
		const textPayload = textChannelContent(agent)
		if (show !== agent) textPayload.content_for_show = show
		if (edit !== agent) textPayload.content_for_edit = edit
		Object.assign(content, textPayload)
	}
	if (hasFiles) content.fileCount = entry.files.length
	if (entry.visibility) content.visibility = entry.visibility
	if (entry.charVisibility?.length) content.charVisibility = entry.charVisibility
	return content
}

/**
 * 取消流式占位：DAG `message_delete`（不依赖 chatLog 索引）。
 * @param {string} groupId 聊天 ID
 * @param {object | null} entry 占位条目（含 `extension.dagEventId`）
 * @param {string} username 所有者
 * @param {string} [dagEventId] 占位 message 事件 id
 * @returns {Promise<void>}
 */
export async function cancelGeneratingPlaceholder(groupId, entry, username, dagEventId) {
	const targetId = dagEventId ?? entry?.extension?.dagEventId
	if (!targetId || !username) return
	const stub = entry?.id
		? entry
		: { id: entry?.id || targetId, extension: { dagEventId: targetId, groupChannelId: entry?.extension?.groupChannelId } }
	await mirrorDeleteToDag(groupId, stub, username)
}

/**
 * 写入 DAG message_edit 终稿；deferrable 权限错误时刷新物化 state 并重试。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {object} eventBody message_edit 事件体
 * @param {number} [attempt] 重试次数
 * @returns {Promise<object>} 已签名事件
 */
async function appendFinalEditWithRetry(username, groupId, eventBody, attempt = 0) {
	try {
		return await appendSignedLocalEvent(username, groupId, eventBody)
	}
	catch (error) {
		if (error?.deferrable && attempt < 4) {
			await getState(username, groupId, { forceFullReplay: attempt >= 2 })
			await new Promise(resolve => { setTimeout(resolve, 40 * (attempt + 1)) })
			return appendFinalEditWithRetry(username, groupId, eventBody, attempt + 1)
		}
		throw error
	}
}

/**
 * §6.4 / §13：流式结束 — DAG `message_edit` 写入终稿。
 * @param {string} groupId 聊天 ID
 * @param {object} entry 最终条目
 * @param {string} username 所有者
 * @param {string} [dagEventId] 占位 message 事件 id
 * @returns {Promise<void>}
 */
export async function finalizeDagGeneratingMessage(groupId, entry, username, dagEventId) {
	try {
		if (!username) return
		if (entry.extension?.isGreeting || entry.extension.timeSlice?.greeting_type) return
		const targetId = dagEventId ?? entry.extension?.dagEventId
		if (!targetId) return
		const text = entryContentToMirrorText(entry)
		const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
		if (!text.trim() && !hasFiles && !entry.extension?.aborted) {
			await cancelGeneratingPlaceholder(groupId, entry, username, targetId)
			return
		}
		const { channelIdForDag, sender, charId } = await resolveMirrorContext(entry, username, groupId)
		let newContent = await buildFinalMessageContent(username, groupId, entry, text, sender)
		const { runWorldAddChatLogEntryHook } = await import('../channel/messageCommit.mjs')
		const hooked = await runWorldAddChatLogEntryHook(
			username,
			groupId,
			channelIdForDag,
			newContent,
			entry,
			charId || entry.extension?.timeSlice?.charname || null,
		)
		newContent = hooked.content
		if (typeof hooked.entry?.content === 'string') entry.content = hooked.entry.content
		const { buildCanonicalMessageContent } = await import('../channel/messageCommit.mjs')
		newContent = await buildCanonicalMessageContent(
			username,
			groupId,
			channelIdForDag,
			newContent,
			{
				charId,
				entry,
				origin: entry.role === 'char' ? 'char' : 'human',
			},
		)
		await appendFinalEditWithRetry(username, groupId, {
			type: 'message_edit',
			channelId: channelIdForDag,
			timestamp: Date.now(),
			content: {
				targetId,
				targetSender: sender,
				newContent,
				chatLogEntryId: entry.id,
			},
		})
	}
	catch (error) {
		if (!error?.deferrable)
			console.error('finalizeDagGeneratingMessage failed:', error)
	}
}

/**
 * 非流式用户/系统消息：单条 DAG `message`（无占位链）。
 * @param {string} groupId 聊天 ID
 * @param {object} entry 条目
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function syncChatLogEntryToDag(groupId, entry, username) {
	try {
		if (entry.is_generating) return
		if (!username) return
		const text = entryContentToMirrorText(entry)
		const hasFiles = Array.isArray(entry.files) && entry.files.length > 0
		if (!text.trim() && !hasFiles) return
		const { channelIdForDag, sender, timestamp, charId } = await resolveMirrorContext(entry, username, groupId)
		const content = await buildFinalMessageContent(username, groupId, entry, text, sender)
		const isGreeting = !!entry.extension?.isGreeting
			|| !!entry.extension?.greetingType
			|| !!entry.extension.timeSlice?.greeting_type
		await commitChannelMessageEvent({
			username,
			groupId,
			channelId: channelIdForDag,
			content,
			charId,
			timestamp,
			entry,
			origin: isGreeting ? 'greeting' : entry.role === 'char' ? 'char' : 'human',
		})
	}
	catch (error) {
		if (!isExpectedTeardownRace(error))
			console.error(error)
	}
}

/**
 * @param {string} groupId 聊天 ID
 * @param {object} deletedEntry 被删条目
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function mirrorDeleteToDag(groupId, deletedEntry, username) {
	try {
		if (!deletedEntry?.id || !username) return
		if (deletedEntry.extension.timeSlice?.greeting_type) return
		await ensureGroup(username, groupId)
		const targetId = deletedEntry.extension?.dagEventId
		if (!targetId) return
		const channelIdForDag = await resolveGroupChannelId(username, groupId, deletedEntry.extension?.groupChannelId)
		const { sender } = await resolveLocalEventSigner(username, groupId)
		await appendSignedLocalEvent(username, groupId, {
			type: 'message_delete',
			channelId: channelIdForDag,
			timestamp: Date.now(),
			content: { targetId, targetSender: sender, chatLogEntryId: deletedEntry.id },
		})
	}
	catch (error) {
		if (!isExpectedTeardownRace(error))
			console.error(error)
	}
}

/**
 * @param {string} groupId 聊天 ID
 * @param {string} originalEntryId 原条目 UUID
 * @param {object} entry 编辑后的条目
 * @param {string} username 所有者
 * @returns {Promise<void>}
 */
export async function mirrorEditToDag(groupId, originalEntryId, entry, username) {
	try {
		if (!originalEntryId || !username) return
		if (entry.extension.timeSlice?.greeting_type) return
		const targetId = entry.extension?.dagEventId
		if (!targetId) return
		const { channelIdForDag, sender, charId } = await resolveMirrorContext(entry, username, groupId)
		let newContent = await buildFinalMessageContent(username, groupId, entry, entryContentToMirrorText(entry), sender)
		const { buildCanonicalMessageContent } = await import('../channel/messageCommit.mjs')
		newContent = await buildCanonicalMessageContent(
			username,
			groupId,
			channelIdForDag,
			newContent,
			{
				charId,
				entry,
				origin: entry.role === 'char' ? 'char' : 'human',
			},
		)
		await appendSignedLocalEvent(username, groupId, {
			type: 'message_edit',
			channelId: channelIdForDag,
			timestamp: Date.now(),
			content: {
				targetId,
				targetSender: sender,
				newContent,
				chatLogEntryId: originalEntryId,
			},
		})
	}
	catch (error) {
		if (!isExpectedTeardownRace(error))
			console.error(error)
	}
}

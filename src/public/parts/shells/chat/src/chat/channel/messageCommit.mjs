/**
 * 【文件】channel/messageCommit.mjs
 * 【职责】DAG-first 消息落盘门面：world AddChatLogEntry（落盘前改写/拒绝）+ canonical content + appendSignedLocalEvent。
 * 【原理】human / char / greeting 共用本入口；AfterAddChatLogEntry 在 broadcastAndPersist 唯一触发；内存 chatLog 仅 hydration 缓存。
 * 【数据结构】canonical message content：全员 displayName/displayAvatar；生成类另附 sessionSnapshot/chatLogEntryId。
 * 【关联】postMessage、chatLogMirror、eventPersist、session/chatRequest、archive/postSnapshot。
 */
import { httpError } from '../../../../../../../scripts/http_error.mjs'
import {
	channelMessageAgentText,
	channelMessageContentObject,
	textChannelContent,
} from '../../../public/shared/channelContent.mjs'
import { resolveDisplaySnapshot } from '../archive/postSnapshot.mjs'
import { appendSignedLocalEvent } from '../dag/append.mjs'
import { resolveLocalEventSigner } from '../dag/localSigner.mjs'
import { getState } from '../dag/materialize.mjs'
import { resolveWorld } from '../session/resolvePart.mjs'
import { exportSessionSnapshot } from '../session/sessionSnapshot.mjs'

/**
 * @param {object} content 频道消息 content
 * @param {object | null | undefined} entry 可选 chatLog 条目
 * @returns {object} 轻量 hook 用条目
 */
function entryForWorldHook(content, entry) {
	if (entry) return entry
	const text = channelMessageAgentText(content) || String(content?.content || '')
	return {
		id: '',
		name: content.displayName || '',
		avatar: content.displayAvatar || '',
		content: text,
		role: content.role || 'user',
		time_stamp: new Date(),
		files: [],
		extension: {
			groupChannelId: content.groupChannelId,
		},
	}
}

/**
 * @param {object} content 原 content
 * @param {object} entry hook 后条目
 * @returns {object} 合并正文后的 content
 */
function applyEntryRewriteToContent(content, entry) {
	const text = typeof entry.content === 'string'
		? entry.content
		: channelMessageAgentText(entry.content) || ''
	const base = channelMessageContentObject(content)
	if (base.type !== 'text' && !text) return base
	const extra = { ...base }
	for (const key of ['type', 'content', 'content_for_show', 'content_for_edit'])
		delete extra[key]
	return textChannelContent(text, {
		...extra,
		...entry.content_for_show != null ? { content_for_show: entry.content_for_show } : {},
		...entry.content_for_edit != null ? { content_for_edit: entry.content_for_edit } : {},
		...entry.role ? { role: entry.role } : {},
		...entry.visibility ? { visibility: entry.visibility } : {},
		...entry.charVisibility?.length ? { charVisibility: entry.charVisibility } : {},
	})
}

/**
 * 运行 world AddChatLogEntry（落盘前）；可改写或抛错拒绝。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} content 拟写入 content
 * @param {object | null | undefined} entry 可选条目
 * @param {string | null | undefined} charname 角色名（agent 上下文）
 * @returns {Promise<{ content: object, entry: object }>} 改写后的 content/entry
 */
export async function runWorldAddChatLogEntryHook(username, groupId, channelId, content, entry, charname = null) {
	const world = await resolveWorld(groupId, channelId, username)
	const hook = world.interfaces.chat.AddChatLogEntry
	if (!hook) return { content: channelMessageContentObject(content), entry: entry || entryForWorldHook(content, entry) }

	// 动态 import：避免 messageCommit ↔ chatRequest ↔ chatLogAppend ↔ chatLogMirror 环依赖
	const { getChatRequest } = await import('../session/chatRequest.mjs')
	const request = await getChatRequest(groupId, charname || undefined, channelId, { replicaUsername: username })
	let hookEntry = entryForWorldHook(content, entry)
	const rewritten = await hook(request, hookEntry)
	if (rewritten != null) hookEntry = rewritten
	if (hookEntry?.reject)
		throw httpError(400, String(hookEntry.reject))
	return {
		content: applyEntryRewriteToContent(content, hookEntry),
		entry: hookEntry,
	}
}

/**
 * 组装 canonical DAG message content（展示快照 + 生成类 sidecar）。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} content 已规范化 content
 * @param {{ charId?: string | null, entry?: object | null, origin?: string }} [opts] 生成类选项
 * @returns {Promise<object>} canonical content
 */
export async function buildCanonicalMessageContent(username, groupId, channelId, content, opts = {}) {
	const { charId = null, entry = null, origin = 'human' } = opts
	const [{ sender }, { state }] = await Promise.all([
		resolveLocalEventSigner(username, groupId),
		getState(username, groupId),
	])
	const display = await resolveDisplaySnapshot(
		state,
		{ sender, charId },
		username,
		groupId,
	)
	const canonical = channelMessageContentObject({
		...channelMessageContentObject(content),
		displayName: display.name,
		...display.avatar ? { displayAvatar: display.avatar } : {},
	})
	const isGeneration = origin === 'char' || origin === 'greeting' || !!charId || entry?.role === 'char'
	if (isGeneration) {
		if (entry?.id) canonical.chatLogEntryId = entry.id
		canonical.sessionSnapshot = await exportSessionSnapshot(username, groupId, channelId)
		if (entry?.role) canonical.role = entry.role
		if (entry?.role === 'char') canonical.charOwner = sender
		if (canonical.is_generating == null && entry?.is_generating)
			canonical.is_generating = true
	}
	return canonical
}

/**
 * 落盘前钩子 + append 权威 message 事件。
 * @param {{
 *   username: string,
 *   groupId: string,
 *   channelId: string,
 *   content: object,
 *   charId?: string | null,
 *   timestamp?: number,
 *   entry?: object | null,
 *   origin?: 'human' | 'char' | 'greeting',
 *   skipWorldHook?: boolean,
 * }} args 落盘参数
 * @returns {Promise<object>} 已签名 DAG 事件
 */
export async function commitChannelMessageEvent(args) {
	const {
		username,
		groupId,
		channelId,
		charId = null,
		timestamp = Date.now(),
		entry = null,
		origin = 'human',
		skipWorldHook = false,
	} = args
	let { content } = args

	if (!skipWorldHook) {
		const hooked = await runWorldAddChatLogEntryHook(
			username,
			groupId,
			channelId,
			content,
			entry,
			charId || entry?.extension?.timeSlice?.charname || null,
		)
		content = hooked.content
		if (entry && hooked.entry && hooked.entry !== entry) {
			if (typeof hooked.entry.content === 'string') entry.content = hooked.entry.content
			if (hooked.entry.content_for_show != null) entry.content_for_show = hooked.entry.content_for_show
			if (hooked.entry.content_for_edit != null) entry.content_for_edit = hooked.entry.content_for_edit
		}
	}

	const canonical = await buildCanonicalMessageContent(username, groupId, channelId, content, {
		charId,
		entry,
		origin,
	})

	const event = await appendSignedLocalEvent(username, groupId, {
		type: 'message',
		channelId,
		timestamp,
		...charId ? { charId } : {},
		content: channelMessageContentObject(canonical),
	})

	if (event?.id && entry)
		entry.extension = { ...entry.extension || {}, dagEventId: event.id }

	return event
}

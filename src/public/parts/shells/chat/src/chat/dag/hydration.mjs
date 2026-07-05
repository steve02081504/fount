/**
 * 【文件】`dag/hydration.mjs` — 频道消息行 → 内存 chatLog 水合。
 * 【职责】从 DAG 衍生的 `messages.jsonl` 重建 `chatMetadata.chatLog`；折叠编辑/删除；解析 GSH/content_ref 展示文本。
 * 【原理】先扫描 `message_edit`/`message_delete` 建 overlay，再对 `message` 行构造 `chatLogEntry_t`；可选 `sessionSnapshot` 恢复 timeSlice；侧车 GC 与 chatLog 对齐。
 * 【数据结构】`buildChatLogEntriesFromChannelLines` 输入频道行数组，输出 `chatLogEntry_t[]`（含 `extension.dagEventId`、`groupChannelId`）。
 * 【关联】`queries.mjs`（经 group queries 读消息）、`chatLogMirror.mjs`、`../session/models.mjs`。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { geti18nForUser } from '../../../../../../../scripts/i18n/index.mjs'
import {
	channelMessageAgentText,
	channelMessageEditText,
	channelMessageShowText,
	isTextChannelContent,
} from '../../../public/shared/channelContent.mjs'
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import { isCkgEncryptedContent } from '../channel_keys/content.mjs'
import { resolveChannelId, resolveGroupChannelId } from '../lib/channelId.mjs'
import { gcLogContextSidecars } from '../lib/contextSidecar.mjs'
import { chatLogEntry_t } from '../session/models.mjs'
import { buildTimeSliceFromSessionSnapshot } from '../session/runtime.mjs'


/**
 * @param {string} username 所有者
 * @returns {Promise<{ decryptUnavailableText: string, contentRefPlaceholder: string, contentRefMismatchText: string, streamFailedNote: string }>} i18n 文案包
 */
export async function loadDagHydrationI18n(username) {
	const [decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText, streamFailedNote] = await Promise.all([
		geti18nForUser(username, 'chat.group.e2eDecryptUnavailable'),
		geti18nForUser(username, 'chat.group.contentRefBodyPending'),
		geti18nForUser(username, 'chat.group.contentRefHashMismatch'),
		geti18nForUser(username, 'chat.group.streamGenerationFailed'),
	])
	return { decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText, streamFailedNote }
}

/**
 * 从已折叠的频道消息行构造 chatLog 条目列表。
 * @param {object[]} lines `readChannelMessagesForUser` 返回的行
 * @param {timeSlice_t} baseSlice 时间切片基准
 * @param {{ decryptUnavailableText: string, contentRefPlaceholder: string, contentRefMismatchText: string, streamFailedNote: string }} i18n 文案
 * @param {string} [sourceChannelId] 来源频道（写入 `extension.groupChannelId`）
 * @param {string} [replicaUsername] 用于 sessionSnapshot 水合
 * @param {string} [groupId] 群 ID
 * @returns {Promise<chatLogEntry_t[]>} 由 DAG 频道行构造的日志条目
 */
export async function buildChatLogEntriesFromChannelLines(lines, baseSlice, i18n, sourceChannelId = null, replicaUsername = null, groupId = null) {
	const { decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText, streamFailedNote } = i18n
	const deleted = new Set()
	/** @type {Map<string, { content?: string, content_for_show?: string, content_for_edit?: string, fileCount?: number, editedAt: number }>} */
	const edits = new Map()
	for (const line of lines) {
		if (line.type === 'message_delete' && line.content?.targetId)
			deleted.add(line.content.targetId)
		if (line.type === 'message_edit' && line.content?.targetId && line.content?.newContent) {
			const messageEventId = line.content.targetId
			const editedAt = Number(line.timestamp) || 0
			const patch = line.content.newContent
			const previous = edits.get(messageEventId)
			if (!previous || editedAt >= previous.editedAt)
				edits.set(messageEventId, {
					content: channelMessageAgentText(patch) || resolveDagMessageText(patch, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText),
					content_for_show: isTextChannelContent(patch) ? channelMessageShowText(patch) : undefined,
					content_for_edit: isTextChannelContent(patch) ? channelMessageEditText(patch) : undefined,
					fileCount: patch?.fileCount,
					editedAt,
				})
		}
	}
	const dagEntries = []
	for (const line of lines) {
		if (line.type !== 'message') continue
		const messageEventId = line.eventId
		if (!messageEventId || deleted.has(messageEventId)) continue
		const entry = await buildChatLogEntryFromDagMessage(
			line,
			baseSlice,
			edits.get(messageEventId),
			decryptUnavailableText,
			contentRefPlaceholder,
			contentRefMismatchText,
			replicaUsername,
			groupId,
			sourceChannelId,
		)
		const groupChannelId = resolveChannelId(sourceChannelId, resolveChannelId(line.channelId))
		entry.extension = { ...entry.extension || {}, groupChannelId }
		if (line.content?.streamGenerationFailed && streamFailedNote)
			entry.content = `${entry.content}\n[${streamFailedNote}]`
		dagEntries.push(entry)
	}
	return dagEntries
}

/**
 * 按侧车可达性根（元数据 + messages 索引 + events + 当前内存 chatLog）对齐各频道 context sidecar。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {chatLogEntry_t[]} chatLog 当前内存中的日志条目
 * @returns {Promise<void>}
 */
export async function reconcileContextSidecarsWithChatLog(username, groupId, chatLog) {
	await gcLogContextSidecars(username, groupId, { chatLog })
}

/**
 * 解析 DAG 消息正文（已解密行直接取 text；未解密 GSH 用占位）。
 * @param {object | undefined} content DAG content
 * @param {string} decryptUnavailableText GSH 加密内容占位文本（§11）
 * @param {string} [contentRefPlaceholder] content_ref 展示用占位（i18n）
 * @param {string} [contentRefMismatchText] content_ref 哈希不一致提示
 * @returns {string} 可展示正文
 */
function resolveDagMessageText(content, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText) {
	if (content?.contentRefHashMismatch)
		return contentRefMismatchText?.trim() || 'content_ref mismatch'
	const ref = content?.content_ref
	if (ref && !content.contentRefResolved)
		return contentRefPlaceholder?.trim()
			|| `[content_ref:${ref.contentHash?.trim().slice(0, 12) || '?'}…]`
	if (content?.decryptView?.failed || isCkgEncryptedContent(content))
		return decryptUnavailableText
	if (content?.type === 'vote')
		return content.question?.trim() || decryptUnavailableText
	const text = channelMessageShowText(content)
	if (text) return text
	return ''
}

/**
 * 从 DAG default 频道行构造 chatLog 条目。
 * @param {object} line DAG 消息事件行
 * @param {timeSlice_t} baseSlice 作为快照基准的时间切片
 * @param {{ content?: string, content_for_show?: string, content_for_edit?: string, fileCount?: number } | undefined} editOverride 编辑折叠后的覆盖字段
 * @param {string} decryptUnavailableText GSH 加密内容占位文本
 * @param {string} [contentRefPlaceholder] content_ref 占位文案
 * @param {string} [contentRefMismatchText] content_ref 校验失败文案
 * @param {string} [replicaUsername] session 快照水合
 * @param {string} [groupId] 群 ID
 * @param {string} [sourceChannelId] 频道 ID
 * @returns {Promise<chatLogEntry_t>} 新构造的日志条目
 */
async function buildChatLogEntryFromDagMessage(
	line,
	baseSlice,
	editOverride,
	decryptUnavailableText,
	contentRefPlaceholder,
	contentRefMismatchText,
	replicaUsername = null,
	groupId = null,
	sourceChannelId = null,
) {
	// 解密失败且无其它字段的消息，messageMerge.attachDecryptView 会把 content 置为 null 并附带 decryptView，
	// 这是合法的展示状态，水合侧必须容忍，否则单条坏消息会让整个 sessions/list 接口 500。
	const content = line.content || {}
	const entry = new chatLogEntry_t()
	entry.id = content.chatLogEntryId || crypto.randomUUID()
	if (line.eventId)
		entry.extension = { ...entry.extension || {}, dagEventId: line.eventId }
	const resolvedShow = resolveDagMessageText(content, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText) ?? ''
	const decryptUnavailableFallback = line.decryptView ? decryptUnavailableText : ''
	entry.content = editOverride?.content != null
		? editOverride.content
		: channelMessageAgentText(content) || resolvedShow || decryptUnavailableFallback
	if (content.type === 'text') {
		const show = editOverride?.content_for_show ?? channelMessageShowText(content)
		if (show && show !== entry.content) entry.content_for_show = show
		const edit = editOverride?.content_for_edit ?? channelMessageEditText(content)
		if (edit && edit !== entry.content) entry.content_for_edit = edit
	}
	entry.role = content.role || 'user'
	const charId = line.charId
	const snapshot = content.sessionSnapshot
	const channelForSnapshot = resolveChannelId(sourceChannelId, resolveChannelId(line.channelId))
	let slice = baseSlice.copy()
	if (snapshot && replicaUsername && groupId)
		slice = await buildTimeSliceFromSessionSnapshot(snapshot, replicaUsername, groupId, channelForSnapshot)

	if (entry.role === 'char') {
		entry.name = charId || 'char'
		entry.extension.timeSlice = slice.copy()
		entry.extension.timeSlice.charname = charId
	}
	else if (entry.role === 'user') {
		entry.name = 'user'
		entry.extension.timeSlice = slice.copy()
	}
	else {
		entry.name = line.sender || entry.role || 'system'
		entry.extension.timeSlice = slice.copy()
	}
	entry.time_stamp = new Date(line.hlc?.wall ?? Date.now()).toISOString()
	const fileCount = editOverride?.fileCount != null ? editOverride.fileCount : content.fileCount
	if (fileCount != null) entry.extension = { ...entry.extension, dagFileCount: fileCount }
	if (content.visibility) entry.visibility = content.visibility
	if (content.charVisibility?.length) entry.charVisibility = content.charVisibility
	return entry
}

/**
 * 将默认频道 DAG 消息重放进内存 chatLog。
 * @param {string} username 用户名
 * @param {string} groupId 聊天 ID
 * @param {chatMetadata_t} chatMetadata 要写入的元数据引用
 * @returns {Promise<void>}
 */
export async function hydrateChatLogFromDag(username, groupId, chatMetadata) {
	const defaultChannelId = await resolveGroupChannelId(username, groupId, null)
	const lines = await readChannelMessagesForUser(username, groupId, defaultChannelId, { limit: 500 })
	const i18n = await loadDagHydrationI18n(username)
	const prelude = chatMetadata.chatLog.filter(entry => entry.extension.timeSlice?.greeting_type)
	const dagEntries = await buildChatLogEntriesFromChannelLines(
		lines,
		chatMetadata.LastTimeSlice,
		i18n,
		defaultChannelId,
		username,
		groupId,
	)

	chatMetadata.chatLog = [...prelude, ...dagEntries].sort((left, right) =>
		new Date(left.time_stamp).getTime() - new Date(right.time_stamp).getTime())
	chatMetadata.timeLines = chatMetadata.chatLog.length
		? [chatMetadata.chatLog[chatMetadata.chatLog.length - 1]]
		: []
	chatMetadata.timeLineIndex = 0
	if (chatMetadata.chatLog.length)
		chatMetadata.LastTimeSlice = chatMetadata.chatLog[chatMetadata.chatLog.length - 1].extension.timeSlice

	await reconcileContextSidecarsWithChatLog(username, groupId, chatMetadata.chatLog)
}

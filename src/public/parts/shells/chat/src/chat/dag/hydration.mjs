/**
 * 【文件】`dag/hydration.mjs` — 频道消息行 → 内存 chatLog 水合。
 * 【职责】从 DAG 衍生的 `messages.jsonl` 重建 `chatMetadata.chatLog`；折叠编辑/删除；解析 GSH/content_ref 展示文本。
 * 【原理】先扫描 `message_edit`/`message_delete` 建 overlay，再对 `message` 行构造 `chatLogEntry_t`；可选 `sessionSnapshot` 恢复 timeSlice；侧车 GC 与 chatLog 对齐。
 * 【数据结构】`buildChatLogEntriesFromChannelLines` 输入频道行数组，输出 `chatLogEntry_t[]`（侧车挂 `extension.chat`）。
 * 【关联】`queries.mjs`（经 group queries 读消息）、`chatLogMirror.mjs`、`../session/models.mjs`。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'

import { geti18nForUser } from '../../../../../../../scripts/i18n/index.mjs'
import {
	channelMessageKind,
	chatExtensionOf,
	messageAgentText,
	messageEditText,
	messageShowText,
} from '../../../public/shared/channelContent.mjs'
import { memberEntityHash } from '../../entity/member.mjs'
import { resolveActiveAgentMemberKeyByCharname } from '../../group/access.mjs'
import { readChannelMessagesForUser } from '../../group/queries.mjs'
import { isChannelKeyEncryptedContent } from '../channel_keys/content.mjs'
import { fileMetaFromState, getDecryptedFile } from '../files/groupFiles.mjs'
import { deriveMessageAttribution } from '../lib/attribution.mjs'
import { resolveChannelId, resolveGroupChannelId } from '../lib/channelId.mjs'
import { gcLogContextSidecars } from '../lib/contextSidecar.mjs'
import { shellChatRoot } from '../lib/paths.mjs'
import { chatLogEntry_t } from '../session/models.mjs'
import { buildTimeSliceFromSessionSnapshot } from '../session/runtime.mjs'


/**
 * 解析频道消息说话人 uid（entityHash 优先）。
 * @param {object} line 频道消息行
 * @param {object} content 消息 content
 * @param {object | null} [state] 物化群状态
 * @returns {string} 说话人 uid
 */
export function resolveSpeakerUid(line, content, state = null) {
	const bridgeHash = String(chatExtensionOf(content)?.bridge?.authorEntityHash || '').trim().toLowerCase()
	if (bridgeHash) return bridgeHash
	const charId = line?.charId ? String(line.charId).trim() : ''
	if (charId && state) {
		const agentKey = resolveActiveAgentMemberKeyByCharname(state, charId)
		const hash = agentKey ? memberEntityHash(state.members[agentKey]) : null
		if (hash) return hash
	}
	const sender = String(line?.sender || '').trim().toLowerCase()
	if (sender && state?.members?.[sender]) {
		const hash = memberEntityHash(state.members[sender])
		if (hash) return hash
	}
	if (sender) return sender
	if (charId) return charId
	return String(content?.role || line?.type || 'system')
}

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
 * @param {string} [sourceChannelId] 来源频道（写入 `extension.chat.channelId`）
 * @param {string} [replicaUsername] 用于 sessionSnapshot 水合
 * @param {string} [groupId] 群 ID
 * @param {object | null} [state] 物化群状态（解析说话人 uid）
 * @returns {Promise<chatLogEntry_t[]>} 由 DAG 频道行构造的日志条目
 */
export async function buildChatLogEntriesFromChannelLines(lines, baseSlice, i18n, sourceChannelId = null, replicaUsername = null, groupId = null, state = null) {
	const { decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText, streamFailedNote } = i18n
	const deleted = new Set()
	/** @type {Map<string, { content?: string, content_for_show?: string, content_for_edit?: string, files?: object[], editedAt: number }>} */
	const edits = new Map()
	for (const line of lines) {
		if (line.type === 'message_delete' && line.content?.targetId)
			deleted.add(line.content.targetId)
		if (line.type === 'message_edit' && line.content?.targetId && line.content?.newContent) {
			const messageEventId = line.content.targetId
			const editedAt = Number(line.timestamp) || 0
			const patch = line.content.newContent
			const previous = edits.get(messageEventId)
			if (!previous || editedAt >= previous.editedAt) {
				const isText = channelMessageKind(patch) === 'text'
				edits.set(messageEventId, {
					content: messageAgentText(patch) || resolveDagMessageText(patch, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText),
					content_for_show: isText ? messageShowText(patch) : undefined,
					content_for_edit: isText ? messageEditText(patch) : undefined,
					files: patch?.files,
					editedAt,
				})
			}
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
			state,
		)
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
 * @param {string} username replica
 * @param {string} contentHashHex 明文哈希
 * @returns {Buffer | null} 本地明文缓存
 */
function tryReadPlaintextCache(username, contentHashHex) {
	const h = String(contentHashHex || '').trim().toLowerCase()
	if (!isHex64(h)) return null
	const path = join(shellChatRoot(username), 'files', h)
	if (!existsSync(path)) return null
	try {
		return readFileSync(path)
	}
	catch {
		return null
	}
}

/**
 * 将 wire `files[]` 反序列化为带惰性 `buffer` getter 的附件描述符（fileId 闭包不外露）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object | null} state 物化群状态
 * @param {object[]} wireFiles 落盘 files
 * @returns {object[] | undefined} 水合附件
 */
export function hydrateWireFiles(username, groupId, state, wireFiles) {
	if (!Array.isArray(wireFiles) || !wireFiles.length) return undefined
	const out = []
	for (const wire of wireFiles) {
		if (!wire || typeof wire !== 'object') continue
		const fileId = String(wire.fileId || '').trim()
		if (!fileId) continue
		const name = String(wire.name || 'file').slice(0, 255)
		const mime_type = String(wire.mime_type || 'application/octet-stream')
		const description = wire.description ? String(wire.description) : ''
		/** @type {Buffer | undefined} */
		let bufferCache
		let loading = false
		const descriptor = { name, mime_type, description }
		Object.defineProperty(descriptor, 'buffer', {
			enumerable: true,
			/**
			 * @returns {Buffer} 附件字节（惰性记忆化）
			 */
			get() {
				if (bufferCache) return bufferCache
				const meta = fileMetaFromState(state, fileId)
				const cached = meta?.contentHash ? tryReadPlaintextCache(username, meta.contentHash) : null
				if (cached) {
					bufferCache = cached
					return bufferCache
				}
				if (!loading && meta) {
					loading = true
					void getDecryptedFile(username, groupId, meta)
						.then(bytes => { bufferCache = Buffer.from(bytes) })
						.catch(() => { bufferCache = Buffer.alloc(0) })
				}
				return bufferCache ?? Buffer.alloc(0)
			},
		})
		out.push(descriptor)
	}
	return out.length ? out : undefined
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
	const chat = chatExtensionOf(content)
	if (content?.contentRefHashMismatch || chat?.contentRefHashMismatch)
		return contentRefMismatchText?.trim() || 'content_ref mismatch'
	const ref = chat?.contentRef
	if (ref && !content?.contentRefResolved && !chat?.contentRefResolved)
		return contentRefPlaceholder?.trim()
			|| `[content_ref:${ref.contentHash?.trim().slice(0, 12) || '?'}…]`
	if (content?.decryptView?.failed || isChannelKeyEncryptedContent(content))
		return decryptUnavailableText
	const text = messageShowText(content)
	if (text) return text
	return ''
}

/**
 * @param {object} entry chatLog 条目
 * @param {object} content wire content
 * @param {object} line DAG 行
 * @param {string | null} sourceChannelId 频道 ID
 * @returns {void}
 */
function mergeChatSidecar(entry, content, line, sourceChannelId) {
	const wireChat = chatExtensionOf(content) || {}
	const channelId = resolveChannelId(sourceChannelId, resolveChannelId(line.channelId))
	const attribution = deriveMessageAttribution(content, {
		sender: line.sender,
		signerEntityHash: wireChat.importedFrom?.signerEntityHash || null,
	})
	const chat = {
		...wireChat,
		eventId: line.eventId,
		channelId,
		attribution,
		...content.name || content.avatar
			? { display: { name: content.name || null, avatar: content.avatar || null } }
			: wireChat.display ? { display: wireChat.display } : {},
	}
	if (wireChat.entryId) chat.entryId = wireChat.entryId
	entry.extension = { ...entry.extension, chat }
}

/**
 * 从 DAG default 频道行构造 chatLog 条目。
 * @param {object} line DAG 消息事件行
 * @param {timeSlice_t} baseSlice 作为快照基准的时间切片
 * @param {{ content?: string, content_for_show?: string, content_for_edit?: string, files?: object[] } | undefined} editOverride 编辑折叠后的覆盖字段
 * @param {string} decryptUnavailableText GSH 加密内容占位文本
 * @param {string} [contentRefPlaceholder] content_ref 占位文案
 * @param {string} [contentRefMismatchText] content_ref 校验失败文案
 * @param {string} [replicaUsername] session 快照水合
 * @param {string} [groupId] 群 ID
 * @param {string} [sourceChannelId] 频道 ID
 * @param {object | null} [state] 物化群状态（解析说话人 uid）
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
	state = null,
) {
	// 解密失败且无其它字段的消息，messageMerge.attachDecryptView 会把 content 置为 null 并附带 decryptView，
	// 这是合法的展示状态，水合侧必须容忍，否则单条坏消息会拖垮整页水合。
	const content = line.content || {}
	const entry = new chatLogEntry_t()
	const entryId = chatExtensionOf(content)?.entryId
	entry.id = entryId || crypto.randomUUID()

	const resolvedShow = resolveDagMessageText(content, decryptUnavailableText, contentRefPlaceholder, contentRefMismatchText) ?? ''
	const decryptUnavailableFallback = line.decryptView ? decryptUnavailableText : ''
	entry.content = editOverride?.content != null
		? editOverride.content
		: messageAgentText(content) || resolvedShow || decryptUnavailableFallback

	const isText = channelMessageKind(content) === 'text'
	if (isText) {
		const show = editOverride?.content_for_show ?? messageShowText(content)
		if (show && show !== entry.content) entry.content_for_show = show
		const edit = editOverride?.content_for_edit ?? messageEditText(content)
		if (edit && edit !== entry.content) entry.content_for_edit = edit
	}

	if (content.locale) entry.locale = content.locale
	if (content.content_warning) entry.content_warning = content.content_warning
	if (content.sensitive_media) entry.sensitive_media = content.sensitive_media

	entry.role = content.role || 'user'
	const charId = line.charId
	const snapshot = chatExtensionOf(content)?.sessionSnapshot
	const channelForSnapshot = resolveChannelId(sourceChannelId, resolveChannelId(line.channelId))
	let slice = baseSlice.copy()
	if (snapshot && replicaUsername && groupId)
		slice = await buildTimeSliceFromSessionSnapshot(snapshot, replicaUsername, groupId, channelForSnapshot)

	const displayName = content.name ? String(content.name).trim() : ''
	if (entry.role === 'char') {
		entry.name = displayName || charId || 'char'
		entry.extension.timeSlice = slice.copy()
		entry.extension.timeSlice.charname = charId
	}
	else if (entry.role === 'user') {
		entry.name = displayName || 'user'
		entry.extension.timeSlice = slice.copy()
	}
	else {
		entry.name = displayName || line.sender || entry.role || 'system'
		entry.extension.timeSlice = slice.copy()
	}
	entry.uid = resolveSpeakerUid(line, content, state)
	entry.time_stamp = new Date(line.hlc?.wall ?? Date.now()).toISOString()

	const wireFiles = editOverride?.files ?? content.files
	if (wireFiles && groupId && replicaUsername)
		entry.files = hydrateWireFiles(replicaUsername, groupId, state, wireFiles) || []

	if (content.visibility) entry.visibility = content.visibility
	if (content.charVisibility?.length) entry.charVisibility = content.charVisibility

	mergeChatSidecar(entry, content, line, sourceChannelId)
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
	const { getState } = await import('./materialize.mjs')
	const { state } = await getState(username, groupId)
	const prelude = chatMetadata.chatLog.filter(entry => entry.extension.timeSlice?.greeting_type)
	const dagEntries = await buildChatLogEntriesFromChannelLines(
		lines,
		chatMetadata.LastTimeSlice,
		i18n,
		defaultChannelId,
		username,
		groupId,
		state,
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

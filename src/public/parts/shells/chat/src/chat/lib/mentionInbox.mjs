/**
 * Chat 跨群 @mention inbox（append-only JSONL + 全局已读水位）。
 */
import fs from 'node:fs'
import { join } from 'node:path'

import { saveJsonFile, loadJsonFileIfExists } from '../../../../../../../scripts/json_loader.mjs'
import { readJsonl, appendJsonlSynced } from '../../../../../../../scripts/p2p/dag/storage.mjs'
import { stripDagEventLocalExtensions } from '../../../../../../../scripts/p2p/dag/strip_extensions.mjs'
import { memberEntityHash } from '../../../../../../../scripts/p2p/entity_id.mjs'
import { extractMentionEntityHashes } from '../../../../../../../scripts/p2p/mentions.mjs'
import { channelMessageShowText } from '../../../public/shared/channelContent.mjs'
import { resolveActiveMemberKeyForLocalUser } from '../../group/access.mjs'
import { enumerateJoinedFederatedGroups } from '../../group/queries.mjs'
import { getState } from '../dag/materialize.mjs'

import { messagesPath, shellChatRoot } from './paths.mjs'
import { resolveOperatorEntityHash } from './replica.mjs'

/**
 * @param {string} username 用户
 * @returns {string} mention inbox 目录
 */
export function mentionInboxDir(username) {
	return join(shellChatRoot(username), 'mention-inbox')
}

/**
 * @param {string} username 用户
 * @returns {string} events.jsonl
 */
export function mentionInboxEventsPath(username) {
	return join(mentionInboxDir(username), 'events.jsonl')
}

/**
 * @param {string} username 用户
 * @returns {string} read.json
 */
export function mentionInboxReadPath(username) {
	return join(mentionInboxDir(username), 'read.json')
}

/**
 * @param {object} row inbox 行
 * @returns {string} 分页游标
 */
export function mentionInboxCursor(row) {
	return `${row.at}:${row.groupId}:${row.eventId}`
}

/**
 * @param {string} username 用户
 * @returns {number} 已读水位毫秒
 */
export function getMentionsSeenAt(username) {
	return Number(loadJsonFileIfExists(mentionInboxReadPath(username))?.seenAt) || 0
}

/**
 * @param {string} username 用户
 * @param {number} at 已读水位
 * @returns {void}
 */
export function setMentionsSeenAt(username, at) {
	const dir = mentionInboxDir(username)
	fs.mkdirSync(dir, { recursive: true })
	saveJsonFile(mentionInboxReadPath(username), { seenAt: Number(at) || Date.now() })
}

/**
 * @param {object} messageLine 频道消息行
 * @returns {string} 可索引正文
 */
export function mentionTextFromMessageLine(messageLine) {
	if (messageLine?.decryptView?.failed) return ''
	const content = messageLine?.content
	if (messageLine?.type === 'message_edit')
		return channelMessageShowText(content?.newContent ?? content)
	if (messageLine?.type !== 'message') return ''
	return channelMessageShowText(content)
}

/**
 * @param {object} messageLine 频道消息行
 * @returns {string | null} 跳转用目标 eventId
 */
export function mentionTargetEventId(messageLine) {
	if (messageLine?.type === 'message_edit')
		return String(messageLine.content?.targetId || '').trim().toLowerCase() || null
	if (messageLine?.type === 'message')
		return String(messageLine.eventId || '').trim().toLowerCase() || null
	return null
}

/**
 * @param {object} state 物化群状态
 * @param {string} senderMemberKey 发送者成员键
 * @returns {{ authorEntityHash: string | null, authorDisplayName: string }} 作者展示信息
 */
export function resolveAuthorFromSender(state, senderMemberKey) {
	const key = String(senderMemberKey || '').trim().toLowerCase()
	const member = state.members?.[key]
	const authorEntityHash = member ? memberEntityHash(member) : null
	const authorDisplayName = String(member?.displayName || member?.charname || '').trim()
		|| (key ? `${key.slice(0, 8)}…` : 'unknown')
	return { authorEntityHash, authorDisplayName }
}

/**
 * 从消息行提取 @ 提及 entityHash 列表（服务端 WS 广播用）。
 * @param {object} messageLine 频道消息行
 * @returns {string[]} entityHash 列表
 */
export function mentionedEntityHashesInMessageLine(messageLine) {
	const text = mentionTextFromMessageLine(messageLine)
	return text ? extractMentionEntityHashes(text) : []
}

/**
 * 从消息行推导 mention inbox 条目（仅 @viewer）。
 * @param {string} viewerEntityHash 本机 operator entityHash
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {object} state 物化群状态
 * @returns {object | null} inbox 行；无匹配时为 null
 */
export function deriveMentionInboxRow(viewerEntityHash, groupId, channelId, messageLine, state) {
	const viewer = String(viewerEntityHash || '').trim().toLowerCase()
	if (!viewer) return null
	const eventId = mentionTargetEventId(messageLine)
	if (!eventId) return null
	const text = mentionTextFromMessageLine(messageLine)
	if (!text) return null
	const mentions = extractMentionEntityHashes(text)
	if (!mentions.includes(viewer)) return null
	const senderKey = String(messageLine.sender || '').trim().toLowerCase()
	const { authorEntityHash, authorDisplayName } = resolveAuthorFromSender(state, senderKey)
	if (authorEntityHash === viewer) return null
	const at = Number(messageLine.hlc?.wall || messageLine.timestamp || messageLine.receivedAt || Date.now())
	return {
		groupId,
		channelId,
		eventId,
		authorEntityHash: authorEntityHash?.toLowerCase() || senderKey,
		authorDisplayName,
		textPreview: text.slice(0, 120),
		at,
	}
}

/**
 * @param {string} username 用户
 * @param {object} row inbox 行
 * @returns {Promise<void>}
 */
async function appendMentionInboxRow(username, row) {
	const dir = mentionInboxDir(username)
	fs.mkdirSync(dir, { recursive: true })
	await appendJsonlSynced(mentionInboxEventsPath(username), row)
}

/**
 * 消息落盘后增量写 mention inbox。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @returns {Promise<void>}
 */
export async function maybeAppendMentionInbox(username, groupId, channelId, messageLine) {
	if (!['message', 'message_edit'].includes(messageLine?.type)) return
	if (messageLine.type === 'message_edit') {
		const newContent = messageLine.content?.newContent ?? messageLine.content
		if (newContent?.is_generating) return
	}
	const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	if (!viewerEntityHash) return
	const { state } = await getState(username, groupId)
	const viewerMemberKey = (await resolveActiveMemberKeyForLocalUser(username, groupId, state))?.toLowerCase()
	const senderKey = String(messageLine.sender || '').trim().toLowerCase()
	if (viewerMemberKey && senderKey === viewerMemberKey) return
	const row = deriveMentionInboxRow(viewerEntityHash, groupId, channelId, messageLine, state)
	if (!row) return
	await appendMentionInboxRow(username, row)
}

/**
 * @param {string} username 用户
 * @param {{ limit?: number, cursor?: string | null }} [options] 分页
 * @returns {Promise<{ mentions: object[], nextCursor: string | null, unreadCount: number }>} 分页结果与未读数
 */
export async function readMentionInbox(username, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const cursor = options.cursor ? String(options.cursor) : null
	const seenAt = getMentionsSeenAt(username)
	const rows = await readJsonl(mentionInboxEventsPath(username)).catch(() => [])
	const deduped = []
	const seen = new Set()
	for (const row of [...rows].sort((left, right) => Number(right.at) - Number(left.at))) {
		const key = mentionInboxCursor(row)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(row)
	}
	let startIndex = 0
	if (cursor) {
		startIndex = deduped.findIndex(row => mentionInboxCursor(row) === cursor) + 1
		if (startIndex <= 0) startIndex = deduped.length
	}
	const page = deduped.slice(startIndex, startIndex + limit)
	const nextCursor = page.length === limit && startIndex + limit < deduped.length
		? mentionInboxCursor(page[page.length - 1])
		: null
	const unreadCount = deduped.filter(row => Number(row.at) > seenAt).length
	return { mentions: page, nextCursor, unreadCount }
}

/**
 * 全量扫描已加入群的消息流重建 mention inbox。
 * @param {string} username 用户
 * @returns {Promise<number>} 写入条数
 */
export async function rebuildMentionInbox(username) {
	const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	if (!viewerEntityHash) return 0
	const dir = mentionInboxDir(username)
	fs.rmSync(dir, { recursive: true, force: true })
	fs.mkdirSync(dir, { recursive: true })
	let written = 0
	const groups = await enumerateJoinedFederatedGroups(username)
	for (const group of groups) {
		const { state } = await getState(username, group.groupId)
		for (const channelId of Object.keys(state.channels || {})) {
			const lines = await readJsonl(messagesPath(username, group.groupId, channelId), { sanitize: stripDagEventLocalExtensions }).catch(() => [])
			for (const line of lines) {
				const row = deriveMentionInboxRow(viewerEntityHash, group.groupId, channelId, line, state)
				if (!row) continue
				await appendMentionInboxRow(username, row)
				written++
			}
		}
	}
	return written
}

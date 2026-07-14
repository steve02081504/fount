/**
 * Chat per-recipient inbox（append-only JSONL + 按收件人分目录的已读水位）。
 */
import fs from 'node:fs'
import { join } from 'node:path'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { normalizeHex64 } from 'npm:@steve02081504/fount-p2p/core/hexIds'
import { readJsonl, appendJsonlSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { saveJsonFile, loadJsonFileIfExists } from '../../../../../../../scripts/json_loader.mjs'
import { channelMessageShowText } from '../../../public/shared/channelContent.mjs'

import { memberEntityHash } from './entity.mjs'
import { shellChatRoot } from './paths.mjs'
import { getLocalNodeHash, resolveOperatorEntityHash } from './replica.mjs'

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @returns {string} inbox 目录
 */
export function chatInboxDir(username, recipientEntityHash) {
	const hash = String(recipientEntityHash || '').trim().toLowerCase()
	return join(shellChatRoot(username), 'inbox', hash)
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @returns {string} events.jsonl
 */
export function chatInboxEventsPath(username, recipientEntityHash) {
	return join(chatInboxDir(username, recipientEntityHash), 'events.jsonl')
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @returns {string} read.json
 */
export function chatInboxReadPath(username, recipientEntityHash) {
	return join(chatInboxDir(username, recipientEntityHash), 'read.json')
}

/**
 * @param {object} row inbox 行
 * @returns {string} 分页游标
 */
export function chatInboxCursor(row) {
	return `${row.at}:${row.groupId}:${row.eventId}`
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @returns {number} 已读水位毫秒
 */
export function getChatInboxSeenAt(username, recipientEntityHash) {
	return Number(loadJsonFileIfExists(chatInboxReadPath(username, recipientEntityHash))?.seenAt) || 0
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @param {number} at 已读水位
 * @returns {void}
 */
export function setChatInboxSeenAt(username, recipientEntityHash, at) {
	const dir = chatInboxDir(username, recipientEntityHash)
	fs.mkdirSync(dir, { recursive: true })
	saveJsonFile(chatInboxReadPath(username, recipientEntityHash), { seenAt: Number(at) || Date.now() })
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
 * 从消息行解析作者（桥接消息优先 extension.bridge 归因）。
 * @param {object} state 物化群状态
 * @param {object} messageLine 频道消息行
 * @returns {{ authorEntityHash: string | null, authorDisplayName: string }}
 */
export function resolveAuthorFromMessageLine(state, messageLine) {
	const bridge = messageLine?.content?.extension?.bridge
	if (bridge?.authorEntityHash) {
		return {
			authorEntityHash: String(bridge.authorEntityHash).trim().toLowerCase(),
			authorDisplayName: String(bridge.authorDisplayName || '').trim() || 'unknown',
		}
	}
	const senderKey = String(messageLine?.sender || '').trim().toLowerCase()
	return resolveAuthorFromSender(state, senderKey)
}

/**
 * 枚举群内本机收件人：operator + 本节点托管 agent 成员。
 * @param {string} username replica
 * @param {object} state 物化群状态
 * @returns {Promise<string[]>} entityHash 列表（小写、去重）
 */
export async function listLocalRecipientsInGroup(username, state) {
	/** @type {string[]} */
	const recipients = []
	const operator = (await resolveOperatorEntityHash(username))?.toLowerCase()
	if (operator) recipients.push(operator)
	const nodeHash = getLocalNodeHash()
	for (const member of Object.values(state.members || {})) {
		if (member?.status !== 'active' || member?.memberKind !== 'agent') continue
		if (normalizeHex64(member.homeNodeHash) !== nodeHash) continue
		const hash = memberEntityHash(member)
		if (hash) recipients.push(hash)
	}
	return [...new Set(recipients)]
}

/**
 * @param {string} recipientEntityHash 收件人
 * @param {string} kind inbox kind
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {object} state 物化群状态
 * @returns {object | null} inbox 行；无正文时为 null
 */
function deriveChatInboxRowFromMessage(recipientEntityHash, kind, groupId, channelId, messageLine, state) {
	const recipient = String(recipientEntityHash || '').trim().toLowerCase()
	if (!recipient) return null
	const eventId = mentionTargetEventId(messageLine)
	if (!eventId) return null
	const text = mentionTextFromMessageLine(messageLine)
	if (!text) return null
	const senderKey = String(messageLine.sender || '').trim().toLowerCase()
	const { authorEntityHash, authorDisplayName } = resolveAuthorFromMessageLine(state, messageLine)
	if (authorEntityHash === recipient) return null
	const at = Number(messageLine.hlc?.wall || messageLine.timestamp || messageLine.receivedAt || Date.now())
	return {
		kind,
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
 * @param {string} recipientEntityHash 收件人
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {object} state 物化群状态
 * @returns {object | null} inbox 行；无正文时为 null
 */
export function deriveChatInboxMentionRow(recipientEntityHash, groupId, channelId, messageLine, state) {
	return deriveChatInboxRowFromMessage(recipientEntityHash, 'mention', groupId, channelId, messageLine, state)
}

/**
 * @param {string} recipientEntityHash 收件人
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {object} state 物化群状态
 * @returns {object | null}
 */
export function deriveChatInboxMessageRow(recipientEntityHash, groupId, channelId, messageLine, state) {
	return deriveChatInboxRowFromMessage(recipientEntityHash, 'message', groupId, channelId, messageLine, state)
}

/**
 * @param {string} recipientEntityHash 收件人
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {object} messageLine 频道消息行
 * @param {object} state 物化群状态
 * @returns {object | null}
 */
export function deriveChatInboxCareRow(recipientEntityHash, groupId, channelId, messageLine, state) {
	return deriveChatInboxRowFromMessage(recipientEntityHash, 'care', groupId, channelId, messageLine, state)
}

/**
 * @param {string} recipientEntityHash 收件人
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} ballotId 投票 ID
 * @param {object} [extra] 附加字段
 * @returns {object} vote_closed 行
 */
export function deriveChatInboxVoteClosedRow(recipientEntityHash, groupId, channelId, ballotId, extra = {}) {
	return {
		kind: 'vote_closed',
		groupId,
		channelId,
		eventId: String(ballotId || '').trim().toLowerCase(),
		authorEntityHash: String(extra.authorEntityHash || '').trim().toLowerCase() || 'system',
		authorDisplayName: extra.authorDisplayName || 'vote',
		textPreview: String(extra.textPreview || '').slice(0, 120),
		at: Number(extra.at) || Date.now(),
		...extra.ballotId ? { ballotId: extra.ballotId } : {},
	}
}
/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @param {object} row inbox 行
 * @returns {Promise<void>}
 */
export async function appendChatInbox(username, recipientEntityHash, row) {
	const dir = chatInboxDir(username, recipientEntityHash)
	fs.mkdirSync(dir, { recursive: true })
	await appendJsonlSynced(chatInboxEventsPath(username, recipientEntityHash), row)
}

/**
 * @param {string} username 用户
 * @param {string} recipientEntityHash 收件人 entityHash
 * @param {{ limit?: number, cursor?: string | null, kinds?: string[] }} [options] 分页
 * @returns {Promise<{ items: object[], nextCursor: string | null, unreadCount: number }>} 分页结果
 */
export async function listChatInbox(username, recipientEntityHash, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const cursor = options.cursor ? String(options.cursor) : null
	const kindSet = options.kinds?.length ? new Set(options.kinds.map(k => String(k))) : null
	const seenAt = getChatInboxSeenAt(username, recipientEntityHash)
	const rows = await readJsonl(chatInboxEventsPath(username, recipientEntityHash)).catch(() => [])
	const deduped = []
	const seen = new Set()
	for (const row of [...rows].sort((left, right) => Number(right.at) - Number(left.at))) {
		if (kindSet && !kindSet.has(row.kind)) continue
		const key = chatInboxCursor(row)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(row)
	}
	let startIndex = 0
	if (cursor) {
		startIndex = deduped.findIndex(row => chatInboxCursor(row) === cursor) + 1
		if (startIndex <= 0) startIndex = deduped.length
	}
	const page = deduped.slice(startIndex, startIndex + limit)
	const nextCursor = page.length === limit && startIndex + limit < deduped.length
		? chatInboxCursor(page[page.length - 1])
		: null
	const unreadCount = deduped.filter(row => Number(row.at) > seenAt).length
	return { items: page, nextCursor, unreadCount }
}

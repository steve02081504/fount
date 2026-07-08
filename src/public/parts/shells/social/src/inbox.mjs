/**
 * 【文件】inbox.mjs — 通知持久 inbox（append-only JSONL + 服务端已读水位）。
 */
import fs from 'node:fs'

import { saveJsonFile, loadJsonFileIfExists } from '../../../../../scripts/json_loader.mjs'
import { appendJsonlSynced, readJsonl } from '../../../../../scripts/p2p/dag/storage.mjs'
import { getUserDictionary } from '../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/operator_identity.mjs'
import { isMutedBy } from '../../../../../scripts/p2p/personal_block.mjs'

import { extractMentionEntityHashes } from './lib/mentions.mjs'
import { canWriteTimeline } from './timeline/append.mjs'
import { pushFeedUpdate } from './ws/feedHub.mjs'

/**
 * @param {object} row 通知条目
 * @returns {string} 分页游标
 */
export function notificationCursor(row) {
	return `${row.at}:${row.actorEntityHash}:${row.type}:${row.postId ?? ''}:${row.targetPostId ?? ''}`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 收件人 entityHash
 * @returns {string} inbox 目录
 */
export function inboxDir(username, entityHash) {
	return `${getUserDictionary(username)}/shells/social/inbox/${entityHash.toLowerCase()}`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 收件人 entityHash
 * @returns {string} inbox events.jsonl
 */
export function inboxEventsPath(username, entityHash) {
	return `${inboxDir(username, entityHash)}/events.jsonl`
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 收件人 entityHash
 * @returns {string} read.json
 */
export function inboxReadPath(username, entityHash) {
	return `${inboxDir(username, entityHash)}/read.json`
}

/**
 * @param {string} type 通知类型
 * @param {string} actorEntityHash 动作来源 timeline owner
 * @param {number} at 时间戳
 * @param {string | null | undefined} postId 相关帖 id
 * @param {string | null | undefined} targetPostId 目标帖 id
 * @returns {object} 规范化通知条目
 */
function inboxRow(type, actorEntityHash, at, postId, targetPostId) {
	return {
		type,
		actorEntityHash: actorEntityHash.toLowerCase(),
		postId: postId ?? null,
		targetPostId: targetPostId ?? null,
		at,
	}
}

/**
 * 从 timeline 事件推导应写入 inbox 的收件人通知。
 * @param {string} timelineOwner 事件所在 timeline owner
 * @param {object} event 签名 timeline 事件
 * @returns {Array<{ recipient: string } & object>} 收件人 + 通知体
 */
export function deriveInboxNotifications(timelineOwner, event) {
	const owner = timelineOwner.toLowerCase()
	const at = Number(event.hlc?.wall) || Number(event.timestamp) || Date.now()
	/** @type {Array<{ recipient: string, type: string, actorEntityHash: string, postId: string | null, targetPostId: string | null, at: number }>} */
	const rows = []

	if (event.type === 'post') {
		const replyTo = event.content?.replyTo
		if (replyTo?.entityHash?.toLowerCase())
			rows.push({ recipient: replyTo.entityHash.toLowerCase(), ...inboxRow('reply', owner, at, event.id, replyTo.postId) })
		for (const mention of extractMentionEntityHashes(event.content?.text || '')) {
			if (mention === owner) continue
			rows.push({ recipient: mention, ...inboxRow('mention', owner, at, event.id, null) })
		}
	}
	if (event.type === 'like') {
		const target = (event.content?.targetEntityHash || '').toLowerCase()
		if (target)
			rows.push({ recipient: target, ...inboxRow('like', owner, at, null, event.content?.targetPostId ?? null) })
	}
	if (event.type === 'repost') {
		const target = (event.content?.targetEntityHash || '').toLowerCase()
		if (target)
			rows.push({ recipient: target, ...inboxRow('repost', owner, at, null, event.content?.targetPostId ?? null) })
	}
	if (event.type === 'follow') {
		const target = (event.content?.targetEntityHash || '').toLowerCase()
		if (target && target !== owner)
			rows.push({ recipient: target, ...inboxRow('follow', owner, at, null, null) })
	}
	return rows
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 收件人
 * @returns {number} 已读水位毫秒
 */
export function getNotificationsSeenAt(username, entityHash) {
	const data = loadJsonFileIfExists(inboxReadPath(username, entityHash))
	return Number(data?.seenAt) || 0
}

/**
 * @param {string} username 用户
 * @param {string} entityHash 收件人
 * @param {number} at 已读水位
 * @returns {void}
 */
export function setNotificationsSeenAt(username, entityHash, at) {
	const dir = inboxDir(username, entityHash)
	fs.mkdirSync(dir, { recursive: true })
	saveJsonFile(inboxReadPath(username, entityHash), { seenAt: Number(at) || Date.now() })
}

/**
 * timeline 事件落盘后增量写 inbox（仅本机可写 entity）。
 * @param {string} username replica
 * @param {string} timelineOwner 事件 timeline owner
 * @param {object} event 签名事件
 * @returns {Promise<void>}
 */
export async function appendInboxFromTimelineEvent(username, timelineOwner, event) {
	for (const row of deriveInboxNotifications(timelineOwner, event)) {
		if (!await canWriteTimeline(username, row.recipient)) continue
		if (await isMutedBy(row.recipient, { entityHash: row.actorEntityHash })) continue
		const dir = inboxDir(username, row.recipient)
		fs.mkdirSync(dir, { recursive: true })
		const { recipient, ...notification } = row
		await appendJsonlSynced(inboxEventsPath(username, recipient), notification)
		pushFeedUpdate(username, { type: 'notification', notification })
	}
}

/**
 * 从 inbox JSONL 读通知页。
 * @param {string} username 用户
 * @param {string} viewerEntityHash 观看者 entityHash
 * @param {{ limit?: number, cursor?: string | null }} [options] 分页
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, unreadCount: number }>} 通知页与未读数
 */
export async function readInboxNotifications(username, viewerEntityHash, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const cursor = options.cursor ? String(options.cursor) : null
	const seenAt = getNotificationsSeenAt(username, viewerEntityHash)
	const rows = await readJsonl(inboxEventsPath(username, viewerEntityHash)).catch(() => [])
	const deduped = []
	const seen = new Set()
	for (const row of [...rows].sort((left, right) => Number(right.at) - Number(left.at))) {
		const key = notificationCursor(row)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(row)
	}
	let startIndex = 0
	if (cursor) {
		startIndex = deduped.findIndex(row => notificationCursor(row) === cursor) + 1
		if (startIndex <= 0) startIndex = deduped.length
	}
	const page = deduped.slice(startIndex, startIndex + limit)
	const nextCursor = page.length === limit && startIndex + limit < deduped.length
		? notificationCursor(page[page.length - 1])
		: null
	const unreadCount = deduped.filter(row => Number(row.at) > seenAt).length
	return { notifications: page, nextCursor, unreadCount }
}

/**
 * 全量扫描 timeline 重建 inbox（运维/修复工具）。
 * @param {string} username 用户
 * @returns {Promise<number>} 写入条数
 */
export async function rebuildInbox(username) {
	const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase()
	if (!viewerEntityHash) return 0
	const dir = inboxDir(username, viewerEntityHash)
	fs.rmSync(dir, { recursive: true, force: true })
	const { buildNotificationsLegacy } = await import('./notifications.mjs')
	const legacy = await buildNotificationsLegacy(username, { limit: 10_000 })
	let written = 0
	fs.mkdirSync(dir, { recursive: true })
	for (const row of legacy.notifications.sort((a, b) => a.at - b.at)) {
		await appendJsonlSynced(inboxEventsPath(username, viewerEntityHash), row)
		written++
	}
	return written
}

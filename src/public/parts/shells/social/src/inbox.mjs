/**
 * 【文件】inbox.mjs — 通知持久 inbox（append-only JSONL + 服务端已读水位 + 读取层聚合）。
 */
import fs from 'node:fs'

import { extractMentionEntityHashes } from 'fount/public/parts/shells/chat/public/shared/mentions.mjs'
import { appendJsonlSynced, readJsonl } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { isMutedBy } from 'npm:@steve02081504/fount-p2p/node/personal_block'

import { saveJsonFile, loadJsonFileIfExists } from '../../../../../scripts/json_loader.mjs'
import { getUserDictionary } from '../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../server/p2p_server/entity_identity.mjs'

import { canWriteTimeline } from './timeline/append.mjs'
import { pushFeedUpdate } from './ws/feedHub.mjs'

/** @type {Set<string>} */
export const VALID_NOTIFICATION_TYPES = new Set(['reply', 'mention', 'like', 'repost', 'follow', 'care_post', 'poll_closed'])

/**
 *
 */
export const FOLLOW_AGGREGATE_WINDOW_MS = 86_400_000
/**
 *
 */
export const SNIPPET_MAX_LEN = 120
/**
 *
 */
export const MAX_DISPLAY_ACTORS = 3

/**
 * @param {string | undefined | null} typesParam 逗号分隔类型
 * @returns {string[] | null} 合法类型列表；无参数时为 null（不过滤）
 */
export function parseNotificationTypesFilter(typesParam) {
	if (!typesParam) return null
	const types = String(typesParam).split(',')
		.map(type => type.trim().toLowerCase())
		.filter(type => VALID_NOTIFICATION_TYPES.has(type))
	return types.length ? types : null
}

/**
 * @param {string | null | undefined} text 原文
 * @param {number} [maxLen=120] 最大长度
 * @returns {string | null} 摘要
 */
export function notificationSnippet(text, maxLen = SNIPPET_MAX_LEN) {
	if (!text) return null
	const plain = String(text)
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`]*`/g, ' ')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[#>*_\-\n\r]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
	if (!plain) return null
	return plain.length <= maxLen ? plain : `${plain.slice(0, maxLen - 1)}…`
}

/**
 * @param {object} row 原始通知行
 * @returns {string} 原始去重键
 */
export function rawNotificationCursor(row) {
	return `${row.at}:${row.actorEntityHash}:${row.type}:${row.postId ?? ''}:${row.targetPostId ?? ''}`
}

/**
 * @param {object} row 通知条目（原始或聚合）
 * @returns {string} 分页游标
 */
export function notificationCursor(row) {
	if (row.aggregateKey)
		return `${row.at}:${row.aggregateKey}`
	return rawNotificationCursor(row)
}

/**
 * @param {object} row 通知行
 * @param {string} viewerEntityHash 收件人
 * @returns {string} 聚合键
 */
export function computeAggregateKey(row, viewerEntityHash) {
	const type = row.type
	if (type === 'like' || type === 'repost') {
		const target = (row.targetEntityHash || viewerEntityHash || '').toLowerCase()
		return `${type}:${target}:${row.targetPostId ?? ''}`
	}
	if (type === 'follow') {
		const bucket = Math.floor(Number(row.at) / FOLLOW_AGGREGATE_WINDOW_MS)
		return `follow:${bucket}`
	}
	return `${type}:${row.actorEntityHash}:${row.postId ?? ''}:${row.targetPostId ?? ''}`
}

/**
 * @param {object[]} rows 原始通知行（已去重）
 * @param {string} viewerEntityHash 收件人
 * @returns {object[]} 聚合后的展示通知
 */
export function aggregateNotificationRows(rows, viewerEntityHash) {
	/** @type {Map<string, object>} */
	const groups = new Map()
	for (const row of rows) {
		const key = row.aggregateKey || computeAggregateKey(row, viewerEntityHash)
		const at = Number(row.at) || 0
		let group = groups.get(key)
		if (!group) {
			/** @type {Map<string, { entityHash: string, at: number }>} */
			const actorMap = new Map([[row.actorEntityHash, { entityHash: row.actorEntityHash, at }]])
			group = {
				type: row.type,
				actorEntityHash: row.actorEntityHash,
				latestActorEntityHash: row.actorEntityHash,
				postId: row.postId ?? null,
				targetPostId: row.targetPostId ?? null,
				targetEntityHash: row.targetEntityHash ?? null,
				snippet: row.snippet ?? null,
				at,
				actorMap,
				actorCount: 1,
				aggregateKey: key,
			}
			groups.set(key, group)
			continue
		}
		group.at = Math.max(group.at, at)
		if (!group.snippet && row.snippet) group.snippet = row.snippet
		if (!group.targetEntityHash && row.targetEntityHash) group.targetEntityHash = row.targetEntityHash
		const prev = group.actorMap.get(row.actorEntityHash)
		if (!prev || at > prev.at) group.actorMap.set(row.actorEntityHash, { entityHash: row.actorEntityHash, at })
		group.actorCount = group.actorMap.size
		const sortedActors = [...group.actorMap.values()].sort((left, right) => right.at - left.at)
		const latest = sortedActors[0]
		if (latest) {
			group.actorEntityHash = latest.entityHash
			group.latestActorEntityHash = latest.entityHash
		}
	}
	return [...groups.values()]
		.map(group => {
			const sortedActors = [...group.actorMap.values()].sort((left, right) => right.at - left.at)
			const { actorMap, ...rest } = group
			return {
				...rest,
				actors: sortedActors.slice(0, MAX_DISPLAY_ACTORS),
			}
		})
		.sort((left, right) => right.at - left.at)
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
 * @param {string | null | undefined} [targetEntityHash] 目标帖 owner
 * @param {string | null | undefined} [snippet] 摘要
 * @returns {object} 规范化通知条目
 */
export function normalizeNotificationRow(type, actorEntityHash, at, postId, targetPostId, targetEntityHash = null, snippet = null) {
	return {
		type,
		actorEntityHash: actorEntityHash.toLowerCase(),
		postId: postId ?? null,
		targetPostId: targetPostId ?? null,
		targetEntityHash: targetEntityHash?.toLowerCase() ?? null,
		snippet: snippet ?? null,
		at,
	}
}

/**
 * @param {string} username replica
 * @param {string} timelineOwner 事件 timeline owner
 * @param {object} event 签名事件
 * @param {object} row 推导出的通知行
 * @returns {Promise<string | null>} 摘要
 */
async function resolveNotificationSnippet(username, timelineOwner, event, row) {
	if (event.type === 'post')
		return notificationSnippet(event.content?.text || '')
	if (event.type === 'like' || event.type === 'repost') {
		const targetOwner = (event.content?.targetEntityHash || '').toLowerCase()
		const targetPostId = event.content?.targetPostId
		if (!targetOwner || !targetPostId) return null
		const { getTimelineMaterialized } = await import('./timeline/materialize.mjs')
		const view = await getTimelineMaterialized(username, targetOwner)
		const post = view.posts.find(entry => entry.id === targetPostId)
		return notificationSnippet(post?.content?.text || '')
	}
	if (row.type === 'reply' && row.targetPostId && row.targetEntityHash) {
		const { getTimelineMaterialized } = await import('./timeline/materialize.mjs')
		const view = await getTimelineMaterialized(username, row.targetEntityHash)
		const post = view.posts.find(entry => entry.id === row.targetPostId)
		return notificationSnippet(post?.content?.text || '')
	}
	return null
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
	/** @type {Array<{ recipient: string, type: string, actorEntityHash: string, postId: string | null, targetPostId: string | null, targetEntityHash: string | null, snippet: string | null, at: number }>} */
	const rows = []

	if (event.type === 'post') {
		const replyTo = event.content?.replyTo
		if (replyTo?.entityHash?.toLowerCase()) {
			const recipient = replyTo.entityHash.toLowerCase()
			rows.push({
				recipient,
				...normalizeNotificationRow('reply', owner, at, event.id, replyTo.postId, recipient),
			})
		}
		for (const mention of extractMentionEntityHashes(event.content?.text || '')) {
			if (mention === owner) continue
			rows.push({ recipient: mention, ...normalizeNotificationRow('mention', owner, at, event.id, null) })
		}
	}
	if (event.type === 'like') {
		const target = (event.content?.targetEntityHash || '').toLowerCase()
		if (target)
			rows.push({
				recipient: target,
				...normalizeNotificationRow('like', owner, at, null, event.content?.targetPostId ?? null, target),
			})
	}
	if (event.type === 'repost') {
		const target = (event.content?.targetEntityHash || '').toLowerCase()
		if (target)
			rows.push({
				recipient: target,
				...normalizeNotificationRow('repost', owner, at, null, event.content?.targetPostId ?? null, target),
			})
	}
	if (event.type === 'follow') {
		const target = (event.content?.targetEntityHash || '').toLowerCase()
		if (target && target !== owner)
			rows.push({ recipient: target, ...normalizeNotificationRow('follow', owner, at, null, null) })
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
 * operator 特别关心作者的新帖：写 care_post inbox 行并触达。
 * @param {string} username replica
 * @param {string} recipientEntityHash 收件人（operator）
 * @param {string} authorEntityHash 发帖作者
 * @param {object} post 签名 post
 * @param {string | null} [snippet] 摘要
 * @returns {Promise<void>}
 */
export async function appendCarePostInboxRow(username, recipientEntityHash, authorEntityHash, post, snippet = null) {
	const recipient = String(recipientEntityHash || '').trim().toLowerCase()
	const author = String(authorEntityHash || '').trim().toLowerCase()
	if (!recipient || !author || recipient === author) return
	if (!await canWriteTimeline(username, recipient)) return
	const at = Number(post.hlc?.wall) || Number(post.timestamp) || Date.now()
	const textSnippet = snippet ?? notificationSnippet(post.content?.text || '')
	const notification = {
		...normalizeNotificationRow('care_post', author, at, post.id, null),
		snippet: textSnippet,
		aggregateKey: computeAggregateKey({
			type: 'care_post',
			actorEntityHash: author,
			postId: post.id,
			targetPostId: null,
			at,
		}, recipient),
	}
	const dir = inboxDir(username, recipient)
	fs.mkdirSync(dir, { recursive: true })
	await appendJsonlSynced(inboxEventsPath(username, recipient), notification)
	pushFeedUpdate(username, { type: 'notification', notification })
	const { notifyUser } = await import('fount/server/web_server/notify/notify.mjs')
	void notifyUser(username, {
		title: 'care_post',
		body: String(textSnippet || 'care_post'),
		url: '/parts/shells:social/',
		tag: `social:care_post:${recipient}`,
	})
}

/**
 * poll 截止后写 poll_closed inbox 行。
 * @param {string} username replica
 * @param {string} recipientEntityHash 收件人
 * @param {string} authorEntityHash 帖作者
 * @param {string} postId 帖 id
 * @param {object} poll poll 配置
 * @param {Record<string, number>} tally 选项计数
 * @returns {Promise<void>}
 */
export async function appendPollClosedInboxRow(username, recipientEntityHash, authorEntityHash, postId, poll, tally) {
	const recipient = String(recipientEntityHash || '').trim().toLowerCase()
	const author = String(authorEntityHash || '').trim().toLowerCase()
	if (!recipient || !author || !postId) return
	if (!await canWriteTimeline(username, recipient)) return
	const at = Date.now()
	const preview = String(poll?.options?.[0] || 'poll closed').slice(0, SNIPPET_MAX_LEN)
	const notification = {
		...normalizeNotificationRow('poll_closed', author, at, postId, null),
		snippet: preview,
		tally,
		aggregateKey: computeAggregateKey({
			type: 'poll_closed',
			actorEntityHash: author,
			postId,
			targetPostId: null,
			at,
		}, recipient),
	}
	const dir = inboxDir(username, recipient)
	fs.mkdirSync(dir, { recursive: true })
	await appendJsonlSynced(inboxEventsPath(username, recipient), notification)
	pushFeedUpdate(username, { type: 'notification', notification })
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
		if (row.actorEntityHash === row.recipient) continue
		if (!await canWriteTimeline(username, row.recipient)) continue
		if (await isMutedBy(row.recipient, { entityHash: row.actorEntityHash })) continue
		const snippet = await resolveNotificationSnippet(username, timelineOwner, event, row)
		const { recipient, ...baseRow } = row
		const dir = inboxDir(username, recipient)
		fs.mkdirSync(dir, { recursive: true })
		const notification = {
			...baseRow,
			snippet,
			aggregateKey: computeAggregateKey({ ...row, snippet }, recipient),
		}
		await appendJsonlSynced(inboxEventsPath(username, recipient), notification)
		pushFeedUpdate(username, { type: 'notification', notification })
		const { notifyUser } = await import('fount/server/web_server/notify/notify.mjs')
		void notifyUser(username, {
			title: row.type,
			body: String(snippet || row.type || ''),
			url: '/parts/shells:social/',
			tag: `social:${row.type}:${recipient}`,
		})
	}
}

/**
 * 从 inbox JSONL 读通知页（聚合后分页）。
 * @param {string} username 用户
 * @param {string} viewerEntityHash 观看者 entityHash
 * @param {{ limit?: number, cursor?: string | null, types?: string[] | null }} [options] 分页与过滤
 * @returns {Promise<{ notifications: object[], nextCursor: string | null, unreadCount: number }>} 通知页与未读数
 */
export async function readInboxNotifications(username, viewerEntityHash, options = {}) {
	const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100)
	const cursor = options.cursor ? String(options.cursor) : null
	const types = options.types ?? null
	const seenAt = getNotificationsSeenAt(username, viewerEntityHash)
	const rows = await readJsonl(inboxEventsPath(username, viewerEntityHash)).catch(() => [])
	const deduped = []
	const seen = new Set()
	for (const row of rows) {
		const key = rawNotificationCursor(row)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(row)
	}
	const filtered = types?.length ? deduped.filter(row => types.includes(row.type)) : deduped
	const aggregated = aggregateNotificationRows(filtered, viewerEntityHash)
	let startIndex = 0
	if (cursor) {
		startIndex = aggregated.findIndex(row => notificationCursor(row) === cursor) + 1
		if (startIndex <= 0) startIndex = aggregated.length
	}
	const page = aggregated.slice(startIndex, startIndex + limit)
	const nextCursor = page.length === limit && startIndex + limit < aggregated.length
		? notificationCursor(page[page.length - 1])
		: null
	const unreadCount = aggregated.filter(row => Number(row.at) > seenAt).length
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
	for (const row of legacy.notifications.sort((left, right) => left.at - right.at)) {
		await appendJsonlSynced(inboxEventsPath(username, viewerEntityHash), row)
		written++
	}
	return written
}

/**
 * Social 直播会话：原生开播或挂载 chat streaming 频道。
 */
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../scripts/json_loader.mjs'

import { liveDanmakuPath, liveDir, liveSessionPath } from '../paths.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId id
 * @returns {object | null} 会话
 */
export function loadLiveSession(username, entityHash, liveId) {
	return loadJsonFileIfExists(liveSessionPath(username, entityHash, liveId))
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @returns {object[]} 活跃会话
 */
export function listActiveLiveSessions(username, entityHash) {
	const dir = liveDir(username, entityHash)
	if (!fs.existsSync(dir)) return []
	const out = []
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith('.json') || name.includes('.danmaku.')) continue
		const row = loadJsonFileIfExists(`${dir}/${name}`)
		if (row?.status === 'live') out.push(row)
	}
	return out
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {object} draft 开播草稿
 * @returns {Promise<object>} 会话
 */
export async function startLiveSession(username, entityHash, draft = {}) {
	const owner = entityHash.toLowerCase()
	const existing = listActiveLiveSessions(username, owner)
	if (existing.length)
		throw httpError(409, 'already live')

	const liveId = randomUUID()
	const visibility = draft.visibility === 'followers' ? 'followers' : 'public'
	const chatMount = draft.groupId && draft.channelId
		? { groupId: String(draft.groupId), channelId: String(draft.channelId || 'default') }
		: null
	const session = {
		liveId,
		entityHash: owner,
		title: String(draft.title || '').trim().slice(0, 120) || 'Live',
		visibility,
		status: 'live',
		startedAt: Date.now(),
		viewerCount: 0,
		chatMount,
		avRoomId: chatMount
			? `${chatMount.groupId}:${chatMount.channelId}`
			: `social:${owner}:${liveId}`,
	}
	fs.mkdirSync(liveDir(username, owner), { recursive: true })
	saveJsonFile(liveSessionPath(username, owner, liveId), session)

	await commitTimelineEvent(username, owner, {
		type: 'live_start',
		content: {
			liveId,
			title: session.title,
			visibility,
			avRoomId: session.avRoomId,
			...chatMount ? { chatMount } : {},
		},
	})

	const { notifyFollowersLiveStarted } = await import('./notify.mjs')
	await notifyFollowersLiveStarted(username, owner, session)
	pushFeedUpdate(username, { type: 'live_started', live: session })
	return session
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId id
 * @returns {Promise<object>} 结束结果
 */
export async function stopLiveSession(username, entityHash, liveId) {
	const owner = entityHash.toLowerCase()
	const id = String(liveId || '').trim().toLowerCase()
	const session = loadLiveSession(username, owner, id)
	if (!session) throw httpError(404, 'live not found')
	session.status = 'ended'
	session.endedAt = Date.now()
	saveJsonFile(liveSessionPath(username, owner, id), session)
	await commitTimelineEvent(username, owner, {
		type: 'live_end',
		content: { liveId: id },
	})
	pushFeedUpdate(username, { type: 'live_ended', liveId: id, entityHash: owner })
	return session
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId id
 * @param {object} row 弹幕
 * @returns {void}
 */
export function appendLiveDanmaku(username, entityHash, liveId, row) {
	const path = liveDanmakuPath(username, entityHash, liveId)
	fs.mkdirSync(liveDir(username, entityHash), { recursive: true })
	fs.appendFileSync(path, `${JSON.stringify(row)}\n`, 'utf8')
}

/**
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} [liveId] 可选指定
 * @returns {Promise<object | null>} 活跃会话
 */
export async function getActiveLiveForEntity(username, entityHash, liveId = null) {
	if (liveId) {
		const session = loadLiveSession(username, entityHash, liveId)
		return session?.status === 'live' ? session : null
	}
	const view = await getTimelineMaterialized(username, entityHash)
	const lives = Object.values(view.activeLives || {})
	if (!lives.length) return listActiveLiveSessions(username, entityHash)[0] || null
	const event = lives[lives.length - 1]
	const id = String(event.content?.liveId || event.id || '').toLowerCase()
	return loadLiveSession(username, entityHash, id)
}

/**
 * Social 直播会话：原生开播或挂载 chat streaming 频道；统计 / 开播帖 / 连线。
 */
import { Buffer } from 'node:buffer'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'

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
 * @param {object} session 会话
 * @returns {void}
 */
export function saveLiveSession(username, entityHash, session) {
	saveJsonFile(liveSessionPath(username, entityHash, session.liveId), session)
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
	const bridgeOrigin = String(draft.bridgeOrigin || '').trim().replace(/\/$/, '')
	const publicWatchSecret = visibility === 'public' ? createLinkSecret() : null
	const mediaKind = ['av', 'audio', 'video', 'whip'].includes(draft.mediaKind) ? draft.mediaKind : 'av'
	const ingestSecret = mediaKind === 'whip' ? createLinkSecret() : null
	const session = {
		liveId,
		entityHash: owner,
		title: String(draft.title || '').trim().slice(0, 120) || 'Live',
		visibility,
		mediaKind,
		ingestSecret,
		status: 'live',
		startedAt: Date.now(),
		viewerCount: 0,
		likeCount: 0,
		bridgeOrigin: bridgeOrigin || null,
		publicWatchSecret,
		stats: {
			viewerHashes: [],
			peakViewers: 0,
			likeCount: 0,
		},
		chatMount,
		avRoomId: chatMount
			? `${chatMount.groupId}:${chatMount.channelId}`
			: `social:${owner}:${liveId}`,
		livePostId: null,
		link: null,
	}
	fs.mkdirSync(liveDir(username, owner), { recursive: true })
	saveLiveSession(username, owner, session)

	await commitTimelineEvent(username, owner, {
		type: 'live_start',
		content: {
			liveId,
			title: session.title,
			visibility,
			mediaKind,
			avRoomId: session.avRoomId,
			bridgeOrigin: session.bridgeOrigin,
			...chatMount ? { chatMount } : {},
		},
	})

	const postEvent = await commitTimelineEvent(username, owner, {
		type: 'post',
		content: {
			text: session.title,
			visibility,
			liveRef: {
				entityHash: owner,
				liveId,
				status: 'live',
				startedAt: session.startedAt,
			},
		},
	})
	session.livePostId = postEvent.id
	saveLiveSession(username, owner, session)

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

	if (session.link) {
		const { tearDownLiveLink } = await import('./link.mjs')
		await tearDownLiveLink(username, owner, id).catch(() => {})
	}

	session.status = 'ended'
	session.endedAt = Date.now()
	const duration = Math.max(0, session.endedAt - (session.startedAt || session.endedAt))
	const totalViewers = Array.isArray(session.stats?.viewerHashes)
		? session.stats.viewerHashes.length
		: 0
	const totalLikes = Number(session.stats?.likeCount || session.likeCount || 0)
	session.liveStats = { duration, totalViewers, totalLikes, peakViewers: session.stats?.peakViewers || 0 }
	saveLiveSession(username, owner, session)

	await commitTimelineEvent(username, owner, {
		type: 'live_end',
		content: { liveId: id, ...session.liveStats },
	})

	if (session.livePostId)
		await commitTimelineEvent(username, owner, {
			type: 'post_edit',
			content: {
				targetPostId: session.livePostId,
				text: session.title,
				liveRef: {
					entityHash: owner,
					liveId: id,
					status: 'ended',
					startedAt: session.startedAt,
					endedAt: session.endedAt,
					...session.liveStats,
				},
			},
		}).catch(error => console.error('live: post_edit on stop failed', error))

	pushFeedUpdate(username, { type: 'live_ended', liveId: id, entityHash: owner, liveStats: session.liveStats })
	return session
}

/**
 * 节流回写观众/点赞统计到 session。
 * @param {string} username replica
 * @param {string} entityHash 主播
 * @param {string} liveId id
 * @param {{ viewerCount?: number, viewerEntityHash?: string, likeDelta?: number }} patch 增量
 * @returns {object | null} 更新后会话
 */
export function patchLiveStats(username, entityHash, liveId, patch = {}) {
	const session = loadLiveSession(username, entityHash, liveId)
	if (!session || session.status !== 'live') return null
	if (!session.stats)
		session.stats = { viewerHashes: [], peakViewers: 0, likeCount: 0 }
	if (typeof patch.viewerCount === 'number') {
		session.viewerCount = Math.max(0, patch.viewerCount)
		session.stats.peakViewers = Math.max(session.stats.peakViewers || 0, session.viewerCount)
	}
	const viewer = String(patch.viewerEntityHash || '').toLowerCase()
	if (viewer) {
		const set = new Set(session.stats.viewerHashes || [])
		set.add(viewer)
		session.stats.viewerHashes = [...set]
	}
	if (patch.likeDelta)
		session.stats.likeCount = Math.max(0, (session.stats.likeCount || 0) + Number(patch.likeDelta))
	session.likeCount = session.stats.likeCount || 0
	saveLiveSession(username, entityHash, session)
	return session
}

/**
 * @param {string} linkSecret 连线密钥
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {string} HMAC token
 */
export function mintLiveBridgeToken(linkSecret, entityHash, liveId) {
	return createHmac('sha256', Buffer.from(String(linkSecret), 'utf8'))
		.update(`${entityHash.toLowerCase()}\0${String(liveId).toLowerCase()}`)
		.digest('base64url')
}

/**
 * @param {string} token 令牌
 * @param {string} linkSecret 密钥
 * @param {string} entityHash 主播
 * @param {string} liveId 直播
 * @returns {boolean} 是否有效
 */
export function verifyLiveBridgeToken(token, linkSecret, entityHash, liveId) {
	if (!token || !linkSecret) return false
	const expect = mintLiveBridgeToken(linkSecret, entityHash, liveId)
	return token === expect
}

/**
 * @returns {string} 随机 linkSecret
 */
export function createLinkSecret() {
	return randomBytes(24).toString('base64url')
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

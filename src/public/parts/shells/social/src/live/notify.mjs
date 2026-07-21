/**
 * 开播通知：本机关注者 inbox + Web Push。
 */
import fs from 'node:fs'

import { appendJsonlSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { notifyUser } from '../../../../../../server/web_server/notify/notify.mjs'
import { listLocalFollowersOf } from '../federation/follower/index.mjs'
import {
	computeAggregateKey,
	inboxDir,
	inboxEventsPath,
	normalizeNotificationRow,
	notificationSnippet,
} from '../inbox.mjs'
import { canWriteTimeline } from '../timeline/append.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

/**
 * @param {string} username replica
 * @param {string} authorEntityHash 主播
 * @param {object} session 直播会话
 * @returns {Promise<void>}
 */
export async function notifyFollowersLiveStarted(username, authorEntityHash, session) {
	const author = authorEntityHash.toLowerCase()
	const followers = await listLocalFollowersOf(author)
	const at = Date.now()
	const snippet = notificationSnippet(session.title || 'live')
	for (const row of followers) {
		if (row.replicaUsername !== username) continue
		const recipient = String(row.entityHash || '').toLowerCase()
		if (!recipient || recipient === author) continue
		if (!await canWriteTimeline(username, recipient)) continue
		const notification = {
			...normalizeNotificationRow('live_started', author, at, null, null),
			snippet,
			liveId: session.liveId,
			aggregateKey: computeAggregateKey({
				type: 'live_started',
				actorEntityHash: author,
				postId: null,
				targetPostId: null,
				at,
				snippet,
			}, recipient),
		}
		fs.mkdirSync(inboxDir(username, recipient), { recursive: true })
		await appendJsonlSynced(inboxEventsPath(username, recipient), notification)
		pushFeedUpdate(username, { type: 'notification', notification })
	}
	void notifyUser(username, {
		title: '直播开始',
		body: snippet,
		url: `/parts/shells:social/#live:${encodeURIComponent(author)}:${encodeURIComponent(session.liveId)}`,
		tag: `live:${session.liveId}`,
	})
}

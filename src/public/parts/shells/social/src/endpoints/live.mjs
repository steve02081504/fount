import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { registerAvRelaySocket } from '../../../chat/src/chat/ws/avRelay.mjs'
import { loadFollowingForActor } from '../following.mjs'
import { canJoinLiveRoom, registerLiveSignalSocket } from '../live/hub.mjs'
import { loadLiveSession } from '../live/session.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 直播 HTTP / WS 路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerLiveRoutes(router) {
	router.post('/api/parts/shells\\:social/live/start', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.startLive(req.body || {}))
	})

	router.post('/api/parts/shells\\:social/live/stop', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const liveId = String(req.body?.liveId || '').trim()
		if (!liveId) throw httpError(400, 'liveId required')
		res.status(200).json(await client.stopLive(liveId))
	})

	router.get('/api/parts/shells\\:social/live/feed', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.liveFeed({
			limit: Number(req.query.limit) || 20,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			scope: req.query.scope ? String(req.query.scope) : 'local',
		}))
	})

	router.get('/api/parts/shells\\:social/live/:entityHash/:liveId', authenticate, async (req, res) => {
		const { username } = await socialClientFromReq(req)
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const liveId = String(req.params.liveId || '').toLowerCase()
		const session = loadLiveSession(username, entityHash, liveId)
		if (!session) throw httpError(404, 'live not found')
		res.status(200).json({ live: session })
	})

	router.ws('/ws/parts/shells\\:social/live/:entityHash/:liveId', authenticate, async (ws, req) => {
		const { client, username } = await socialClientFromReq(req)
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const liveId = String(req.params.liveId || '').toLowerCase()
		const session = loadLiveSession(username, entityHash, liveId)
		if (!session || session.status !== 'live') {
			ws.close(4004, 'not_live')
			return
		}
		if (session.visibility === 'followers') {
			const { following } = await loadFollowingForActor(username, client.entityHash)
			if (!following.includes(entityHash) && client.entityHash !== entityHash) {
				ws.close(4003, 'followers_only')
				return
			}
		}
		if (!canJoinLiveRoom(username, entityHash, liveId, client.entityHash)) {
			ws.close(4004, 'not_live')
			return
		}
		registerLiveSignalSocket(entityHash, liveId, ws, {
			username,
			viewerEntityHash: client.entityHash,
		})
		ws.send(JSON.stringify({ type: 'hello', liveId, entityHash }))
	})

	router.ws('/ws/parts/shells\\:social/live-av/:entityHash/:liveId', authenticate, async (ws, req) => {
		const { client, username } = await socialClientFromReq(req)
		const entityHash = String(req.params.entityHash || '').toLowerCase()
		const liveId = String(req.params.liveId || '').toLowerCase()
		const session = loadLiveSession(username, entityHash, liveId)
		if (!session || session.status !== 'live') {
			ws.close(4004, 'not_live')
			return
		}
		if (session.visibility === 'followers') {
			const { following } = await loadFollowingForActor(username, client.entityHash)
			if (!following.includes(entityHash) && client.entityHash !== entityHash) {
				ws.close(4003, 'followers_only')
				return
			}
		}
		registerAvRelaySocket(session.avRoomId || `social:${entityHash}:${liveId}`, ws)
	})
}

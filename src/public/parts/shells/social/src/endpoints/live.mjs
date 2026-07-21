import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'
import { startWhipIngest, stopWhipIngest } from '../../../chat/src/chat/whip/ingest.mjs'
import {
	injectAvRelayControl,
	injectAvRelayFrame,
	registerAvRelaySocket,
	subscribeAvRelayFrames,
	subscribeAvRelayControls,
} from '../../../chat/src/chat/ws/avRelay.mjs'
import { loadFollowingForActor } from '../following.mjs'
import {
	canJoinLiveRoom,
	ingestBridgedLiveSignal,
	registerLiveSignalSocket,
} from '../live/hub.mjs'
import { loadLiveSession, verifyLiveBridgeToken } from '../live/session.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 直播 HTTP / WS 路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerLiveRoutes(router) {
	router.post('/api/parts/shells\\:social/live/start', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const body = { ...req.body }
		if (!body.bridgeOrigin) {
			const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
			const host = req.headers['x-forwarded-host'] || req.headers.host
			if (host) body.bridgeOrigin = `${proto}://${host}`
		}
		res.status(200).json(await client.startLive(body))
	})

	router.post('/api/parts/shells\\:social/live/stop', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const liveId = String(req.body.liveId).trim()
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
		const entityHash = String(req.params.entityHash).toLowerCase()
		const liveId = String(req.params.liveId).toLowerCase()
		const session = loadLiveSession(username, entityHash, liveId)
		if (!session) throw httpError(404, 'live not found')
		res.status(200).json({ live: session })
	})

	router.post('/api/parts/shells\\:social/live/:liveId/whip', authenticate, async (req, res) => {
		const { client, username } = await socialClientFromReq(req)
		const liveId = String(req.params.liveId).toLowerCase()
		const session = loadLiveSession(username, client.entityHash, liveId)
		if (!session || session.status !== 'live') throw httpError(404, 'live not found')
		const auth = String(req.headers.authorization || '')
		const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
		if (!session.ingestSecret || token !== session.ingestSecret) throw httpError(403, 'bad ingest token')
		const offerSdp = typeof req.body === 'string' ? req.body : String(req.body)
		if (!offerSdp.includes('v=0')) throw httpError(400, 'sdp required')
		const avRoomId = session.avRoomId || `social:${client.entityHash}:${liveId}`
		const { answerSdp } = await startWhipIngest(avRoomId, offerSdp)
		const location = `/api/parts/shells:social/live/${liveId}/whip`
		res.setHeader('Location', location)
		res.status(201).type('application/sdp').send(answerSdp)
	})

	router.delete('/api/parts/shells\\:social/live/:liveId/whip', authenticate, async (req, res) => {
		const { client, username } = await socialClientFromReq(req)
		const liveId = String(req.params.liveId).toLowerCase()
		const session = loadLiveSession(username, client.entityHash, liveId)
		if (!session) throw httpError(404, 'live not found')
		const avRoomId = session.avRoomId || `social:${client.entityHash}:${liveId}`
		stopWhipIngest(avRoomId)
		res.status(200).json({ ok: true })
	})

	router.post('/api/parts/shells\\:social/live/:liveId/link/invite', authenticate, async (req, res) => {
		const { client, username } = await socialClientFromReq(req)
		const liveId = String(req.params.liveId).toLowerCase()
		const { inviteLiveLink } = await import('../live/link.mjs')
		res.status(200).json(await inviteLiveLink(username, client.entityHash, liveId, req.body))
	})

	router.post('/api/parts/shells\\:social/live/:liveId/link/stop', authenticate, async (req, res) => {
		const { client, username } = await socialClientFromReq(req)
		const liveId = String(req.params.liveId).toLowerCase()
		const { tearDownLiveLink } = await import('../live/link.mjs')
		await tearDownLiveLink(username, client.entityHash, liveId)
		res.status(200).json({ ok: true })
	})

	router.ws('/ws/parts/shells\\:social/live/:entityHash/:liveId', authenticate, async (ws, req) => {
		const { client, username } = await socialClientFromReq(req)
		const entityHash = String(req.params.entityHash).toLowerCase()
		const liveId = String(req.params.liveId).toLowerCase()
		let session = loadLiveSession(username, entityHash, liveId)
		if ((!session || session.status !== 'live') && req.query?.proxy === '1') {
			const { ensureFederatedLiveProxy } = await import('../live/viewerProxy.mjs')
			session = await ensureFederatedLiveProxy(username, entityHash, liveId, {
				bridgeOrigin: String(req.query.bridgeOrigin || ''),
				watchSecret: String(req.query.watchSecret || ''),
				nodeHash: String(req.query.nodeHash || ''),
			})
		}
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
		if (!canJoinLiveRoom(username, entityHash, liveId) && !session.federatedProxy) {
			ws.close(4004, 'not_live')
			return
		}
		registerLiveSignalSocket(entityHash, liveId, ws, {
			username,
			viewerEntityHash: client.entityHash,
		})
		ws.send(JSON.stringify({
			type: 'hello',
			liveId,
			entityHash,
			likeCount: session.likeCount || 0,
			link: session.link || null,
		}))
	})

	router.ws('/ws/parts/shells\\:social/live-av/:entityHash/:liveId', authenticate, async (ws, req) => {
		const { client, username } = await socialClientFromReq(req)
		const entityHash = String(req.params.entityHash).toLowerCase()
		const liveId = String(req.params.liveId).toLowerCase()
		let session = loadLiveSession(username, entityHash, liveId)
		if ((!session || session.status !== 'live') && req.query?.proxy === '1') {
			const { ensureFederatedLiveProxy } = await import('../live/viewerProxy.mjs')
			session = await ensureFederatedLiveProxy(username, entityHash, liveId, {
				bridgeOrigin: String(req.query.bridgeOrigin || ''),
				watchSecret: String(req.query.watchSecret || ''),
				nodeHash: String(req.query.nodeHash || ''),
			})
		}
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

	// 跨节点连线 / 观众代理：token = HMAC(linkSecret)；公开观看代理用 session.publicWatchSecret
	router.ws('/ws/parts/shells\\:social/live-bridge/:entityHash/:liveId', async (ws, req) => {
		const entityHash = String(req.params.entityHash).toLowerCase()
		const liveId = String(req.params.liveId).toLowerCase()
		const token = String(req.query.token || '')
		const { getAllUserNames } = await import('../../../../../../server/auth/index.mjs')
		let matched = null
		let matchedUser = null
		for (const username of getAllUserNames()) {
			const session = loadLiveSession(username, entityHash, liveId)
			if (!session || session.status !== 'live') continue
			const secret = session.link?.linkSecret || session.publicWatchSecret
			if (secret && verifyLiveBridgeToken(token, secret, entityHash, liveId)) {
				matched = session
				matchedUser = username
				break
			}
		}
		if (!matched) {
			ws.close(4003, 'bad_token')
			return
		}
		const avRoomId = matched.avRoomId || `social:${entityHash}:${liveId}`
		const unsub = subscribeAvRelayFrames(avRoomId, buf => {
			if (ws.readyState !== 1) return
			try { ws.send(buf, { binary: true }) } catch { /* skip */ }
		})
		const unsubCtrl = subscribeAvRelayControls(avRoomId, text => {
			if (ws.readyState !== 1) return
			try { ws.send(text) } catch { /* skip */ }
		})
		ws.on('message', (data, isBinary) => {
			if (isBinary) {
				injectAvRelayFrame(avRoomId, data)
				return
			}
			let wireMessage
			try { wireMessage = JSON.parse(String(data)) }
			catch { return }
			if (wireMessage?.type === 'publish_meta' || wireMessage?.type === 'publish_meta_revoke') {
				injectAvRelayControl(avRoomId, wireMessage)
				return
			}
			ingestBridgedLiveSignal(matchedUser, entityHash, liveId, wireMessage)
		})
		ws.on('close', () => { unsub(); unsubCtrl() })
		ws.send(JSON.stringify({ type: 'hello', bridge: true, entityHash, liveId }))
	})
}

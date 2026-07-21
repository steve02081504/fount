import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { registerFeedSocket } from '../ws/feedHub.mjs'

import { socialJson } from './shared.mjs'

/**
 * 注册 feed 与 WebSocket 相关路由（读侧经 SocialClient；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerFeedRoutes(router) {
	router.get('/api/parts/shells\\:social/feed', authenticate, socialJson((req, { client }) => {
		const ranking = String(req.query.ranking || 'latest').toLowerCase()
		return client.feed({
			mode: ranking === 'for_you' ? 'forYou' : 'home',
			ranking,
			limit: Number(req.query.limit) || 50,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		})
	}))

	router.post('/api/parts/shells\\:social/feed/sync', authenticate, socialJson((_req, { client }) =>
		client.syncFollowing()))

	router.ws('/ws/parts/shells\\:social/feed', authenticate, async (ws, req) => {
		const { username } = getUserByReq(req)
		registerFeedSocket(username, ws)
		ws.send(JSON.stringify({ type: 'hello' }))
	})
}

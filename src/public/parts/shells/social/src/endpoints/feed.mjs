import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { buildHomeFeed } from '../feed.mjs'
import { syncFollowingTimelines } from '../timeline/sync.mjs'
import { registerFeedSocket } from '../ws/feedHub.mjs'

/**
 * 注册 feed 与 WebSocket 相关路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerFeedRoutes(router) {
	router.get('/api/parts/shells\\:social/feed', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const feed = await buildHomeFeed(username, {
			limit: Number(req.query.limit) || 50,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		})
		res.status(200).json(feed)
	})

	router.post('/api/parts/shells\\:social/feed/sync', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		await syncFollowingTimelines(username)
		res.status(200).json({ synced: true })
	})

	router.ws('/ws/parts/shells\\:social/feed', authenticate, async (ws, req) => {
		const { username } = getUserByReq(req)
		registerFeedSocket(username, ws)
		ws.send(JSON.stringify({ type: 'hello' }))
	})
}

import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { buildHomeFeed } from '../feed.mjs'
import { buildForYouFeed } from '../feed/ranking.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'
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
		const actingEntityHash = await resolveActingEntity(username, req.query.actingEntityHash, { requireEntity: false })
		const ranking = String(req.query.ranking || 'latest').toLowerCase()
		const options = {
			actingEntityHash,
			limit: Number(req.query.limit) || 50,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}
		const feed = ranking === 'for_you'
			? await buildForYouFeed(username, options)
			: await buildHomeFeed(username, options)
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

import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { discoverWithNetwork } from '../discover/network.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'

/**
 * 注册探索页路由（账户与公开帖推荐）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerExploreRoutes(router) {
	router.get('/api/parts/shells\\:social/explore', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntityHash = await resolveActingEntity(username, req.query.actingEntityHash, { requireEntity: false })
		res.status(200).json(await discoverWithNetwork(username, {
			type: 'social_discover_request',
			n: Number(req.query.limit) || 20,
		}, { actingEntityHash }))
	})

	router.get('/api/parts/shells\\:social/explore/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntityHash = await resolveActingEntity(username, req.query.actingEntityHash, { requireEntity: false })
		res.status(200).json(await discoverWithNetwork(username, {
			type: 'social_post_discover_request',
			n: Number(req.query.limit) || 20,
			mediaOnly: req.query.mediaOnly === 'true',
		}, { actingEntityHash }))
	})
}

import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册探索页路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerExploreRoutes(router) {
	router.get('/api/parts/shells\\:social/explore', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.explore({
			limit: Number(req.query.limit) || 20,
		}))
	})

	router.get('/api/parts/shells\\:social/explore/posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.explorePosts({
			limit: Number(req.query.limit) || 20,
			mediaOnly: req.query.mediaOnly === 'true',
		}))
	})
}

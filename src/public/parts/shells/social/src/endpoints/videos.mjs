import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 短视频流路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerVideosRoutes(router) {
	router.get('/api/parts/shells\\:social/videos/feed', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.videosFeed({
			limit: Number(req.query.limit) || 20,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})
}

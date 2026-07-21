import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/**
 * 短视频流路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerVideosRoutes(router) {
	router.get('/api/parts/shells\\:social/videos/feed', authenticate, socialJson((req, { client }) =>
		client.videosFeed({
			limit: Number(req.query.limit) || 20,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		})))
}

import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/**
 * 注册探索页路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerExploreRoutes(router) {
	router.get('/api/parts/shells\\:social/explore', authenticate, socialJson((req, { client }) =>
		client.explore({ limit: Number(req.query.limit) || 20 })))

	router.get('/api/parts/shells\\:social/explore/posts', authenticate, socialJson((req, { client }) =>
		client.explorePosts({
			limit: Number(req.query.limit) || 20,
			mediaOnly: req.query.mediaOnly === 'true',
		})))
}

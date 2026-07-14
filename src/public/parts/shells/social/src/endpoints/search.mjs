import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册搜索路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSearchRoutes(router) {
	router.get('/api/parts/shells\\:social/search', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const searchQuery = String(req.query.q || '').trim()
		if (searchQuery.length < 2)
			throw httpError(400, 'query must be at least 2 characters')
		res.status(200).json(await client.search(searchQuery, {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})
}

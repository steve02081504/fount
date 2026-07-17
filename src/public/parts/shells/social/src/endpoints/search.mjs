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
		const hasFilter = Boolean(req.query.author || req.query.media || req.query.tag || req.query.scope)
		if (searchQuery.length < 2 && !hasFilter)
			throw httpError(400, 'query must be at least 2 characters')
		res.status(200).json(await client.search(searchQuery || String(req.query.tag || req.query.media || 'media'), {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			author: req.query.author ? String(req.query.author) : undefined,
			media: req.query.media ? String(req.query.media) : undefined,
			tag: req.query.tag ? String(req.query.tag) : undefined,
			before: req.query.before ? Number(req.query.before) : undefined,
			after: req.query.after ? Number(req.query.after) : undefined,
			sort: req.query.sort ? String(req.query.sort) : undefined,
			scope: req.query.scope ? String(req.query.scope) : undefined,
			q: searchQuery,
		}))
	})
}

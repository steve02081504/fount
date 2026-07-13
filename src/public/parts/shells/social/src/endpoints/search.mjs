import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'
import { searchPosts } from '../search.mjs'

/**
 * 注册搜索路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSearchRoutes(router) {
	router.get('/api/parts/shells\\:social/search', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const searchQuery = String(req.query.q || '').trim()
		if (searchQuery.length < 2)
			throw httpError(400, 'query must be at least 2 characters')
		const actingEntityHash = await resolveActingEntity(username, req.query.actingEntityHash, { requireEntity: false })
		res.status(200).json(await searchPosts(username, {
			q: searchQuery,
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			actingEntityHash,
		}))
	})
}

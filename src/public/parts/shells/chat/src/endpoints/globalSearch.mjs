import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHash } from '../chat/lib/replica.mjs'
import { searchAllGroups } from '../chat/search/global.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerGlobalSearchRoutes(router) {
	router.get('/api/parts/shells\\:chat/search', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const query = String(req.query.q || '').trim()
		if (query.length < 2)
			throw httpError(400, 'query must be at least 2 characters')
		const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
		res.status(200).json(await searchAllGroups(username, {
			q: query,
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			viewerEntityHash,
		}))
	})
}

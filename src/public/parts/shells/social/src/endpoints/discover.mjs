import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { suggestMentions } from '../lib/mentionSuggest.mjs'
import { buildTrendingHashtags } from '../trending/hashtags.mjs'
import { buildNearbyTrendingHashtags } from '../trending/network.mjs'

/**
 * 注册趋势与 @ 建议路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDiscoverRoutes(router) {
	router.get('/api/parts/shells\\:social/hashtags/trending', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const scope = String(req.query.scope || 'local').toLowerCase()
		const opts = { limit: Number(req.query.limit) || 12 }
		if (scope === 'nearby')
			res.status(200).json(await buildNearbyTrendingHashtags(username, opts))
		else
			res.status(200).json({ ...(await buildTrendingHashtags(username, opts)), scope: 'local' })
	})

	router.get('/api/parts/shells\\:social/mentions/suggest', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await suggestMentions(username, String(req.query.q || ''), Number(req.query.limit) || 20))
	})
}

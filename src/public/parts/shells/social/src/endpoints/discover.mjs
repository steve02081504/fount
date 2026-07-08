import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { discoverWithNetwork } from '../discover/network.mjs'
import { suggestMentions } from '../lib/mentionSuggest.mjs'
import { buildTrendingHashtags } from '../trending/hashtags.mjs'

/**
 * 注册探索、趋势与 @ 建议路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDiscoverRoutes(router) {
	router.get('/api/parts/shells\\:social/hashtags/trending', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await buildTrendingHashtags(username, {
			limit: Number(req.query.limit) || 12,
		}))
	})

	router.get('/api/parts/shells\\:social/explore', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await discoverWithNetwork(username, {
			type: 'social_discover_request',
			n: Number(req.query.limit) || 20,
		}))
	})

	router.get('/api/parts/shells\\:social/explore/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await discoverWithNetwork(username, {
			type: 'social_post_discover_request',
			n: Number(req.query.limit) || 20,
			mediaOnly: req.query.mediaOnly === 'true',
		}))
	})

	router.get('/api/parts/shells\\:social/mentions/suggest', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await suggestMentions(username, String(req.query.q || ''), Number(req.query.limit) || 20))
	})
}

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { routeEntityHash, socialClientFromReq } from './shared.mjs'

/**
 * 注册资料读路由与 meta 更新（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerProfileRoutes(router) {
	// 静态段必须在 :entityHash 之前，否则 muted-keywords 会被当成 entityHash → 400
	router.get('/api/parts/shells\\:social/profile/muted-keywords', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.mutedKeywords.list())
	})

	router.put('/api/parts/shells\\:social/profile/muted-keywords', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.mutedKeywords.replace(req.body?.entries || []))
	})

	router.post('/api/parts/shells\\:social/profile/meta', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const socialMeta = await client.updateMeta({
			hideFromDiscovery: req.body?.hideFromDiscovery,
		})
		res.status(200).json({ socialMeta })
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.profile(routeEntityHash(req.params)))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.profilePosts(routeEntityHash(req.params), {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/likes', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.profileLikes(routeEntityHash(req.params)))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/following', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.profileFollowing(routeEntityHash(req.params)))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/followers', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.profileFollowers(routeEntityHash(req.params)))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/replies/:postId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const postId = String(req.params.postId)
		if (!postId) throw httpError(400, 'invalid params')
		res.status(200).json(await client.profileReplies(routeEntityHash(req.params), postId))
	})

	router.post('/api/parts/shells\\:social/timeline/:entityHash/maintain', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.maintainTimeline(routeEntityHash(req.params)))
	})
}

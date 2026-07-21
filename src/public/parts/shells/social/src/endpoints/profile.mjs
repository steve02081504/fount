import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { routeEntityHash, socialJson } from './shared.mjs'

/**
 * 注册资料读路由与 meta 更新（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerProfileRoutes(router) {
	// 静态段必须在 :entityHash 之前，否则 muted-keywords 会被当成 entityHash → 400
	router.get('/api/parts/shells\\:social/profile/muted-keywords', authenticate, socialJson((_req, { client }) =>
		client.mutedKeywords.list()))

	router.put('/api/parts/shells\\:social/profile/muted-keywords', authenticate, socialJson((req, { client }) =>
		client.mutedKeywords.replace(req.body?.entries || [])))

	router.post('/api/parts/shells\\:social/profile/meta', authenticate, socialJson(async (req, { client }) => ({
		socialMeta: await client.updateMeta({ hideFromDiscovery: req.body?.hideFromDiscovery }),
	})))

	router.get('/api/parts/shells\\:social/profile/:entityHash', authenticate, socialJson((req, { client }) =>
		client.profile(routeEntityHash(req.params))))

	router.get('/api/parts/shells\\:social/profile/:entityHash/posts', authenticate, socialJson((req, { client }) =>
		client.profilePosts(routeEntityHash(req.params), {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		})))

	router.get('/api/parts/shells\\:social/profile/:entityHash/likes', authenticate, socialJson((req, { client }) =>
		client.profileLikes(routeEntityHash(req.params))))

	router.get('/api/parts/shells\\:social/profile/:entityHash/following', authenticate, socialJson((req, { client }) =>
		client.profileFollowing(routeEntityHash(req.params))))

	router.get('/api/parts/shells\\:social/profile/:entityHash/followers', authenticate, socialJson((req, { client }) =>
		client.profileFollowers(routeEntityHash(req.params))))

	router.get('/api/parts/shells\\:social/profile/:entityHash/replies/:postId', authenticate, socialJson(async (req, { client }) => {
		const postId = String(req.params.postId)
		if (!postId) throw httpError(400, 'invalid params')
		return client.profileReplies(routeEntityHash(req.params), postId)
	}))

	router.post('/api/parts/shells\\:social/timeline/:entityHash/maintain', authenticate, socialJson((req, { client }) =>
		client.maintainTimeline(routeEntityHash(req.params))))
}

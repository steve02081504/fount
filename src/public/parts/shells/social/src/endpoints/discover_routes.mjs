import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { getReplicaFromReq } from '../../../../../../server/p2p_server/http_glue.mjs'
import { discoverWithNetwork } from '../discovery.mjs'
import { getEntityProfile } from '../feed.mjs'
import { ensureOperatorSocialReady } from '../lib/bootstrap.mjs'
import { suggestMentions } from '../lib/mentionSuggest.mjs'
import { buildNotifications } from '../notifications.mjs'
import { searchPosts } from '../search.mjs'
import { buildTrendingHashtags } from '../trending/hashtags.mjs'

/**
 * 注册探索、搜索、通知与 @ 建议路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDiscoverRoutes(router) {
	router.get('/api/parts/shells\\:social/search', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const searchQuery = String(req.query.q || '').trim()
		if (searchQuery.length < 2)
			return res.status(400).json({ error: 'query must be at least 2 characters' })
		res.status(200).json(await searchPosts(username, {
			q: searchQuery,
			limit: Number(req.query.limit) || 30,
		}))
	})

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

	router.get('/api/parts/shells\\:social/notifications', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100)
		res.status(200).json(await buildNotifications(username, limit))
	})

	router.get('/api/parts/shells\\:social/mentions/suggest', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await suggestMentions(username, String(req.query.q || ''), Number(req.query.limit) || 20))
	})

	router.get('/api/parts/shells\\:social/viewer', authenticate, async (req, res) => {
		const { replicaUsername, operatorEntityHash } = await getReplicaFromReq(req)
		const entityHash = operatorEntityHash
			? await ensureOperatorSocialReady(replicaUsername)
			: null
		const profile = entityHash
			? await getEntityProfile(replicaUsername, entityHash)
			: null
		res.status(200).json({
			viewerEntityHash: entityHash,
			profile,
		})
	})
}

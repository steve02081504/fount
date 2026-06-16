import { getReplicaFromReq, resolveOperatorEntityHash } from '../../../../../../scripts/p2p/entity/replica.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { discoverWithNetwork } from '../discovery.mjs'
import { getEntityProfile } from '../feed.mjs'
import { ensureOperatorSocialReady } from '../lib/bootstrap.mjs'
import { listLocalAgentEntities } from '../lib/entityResolve.mjs'
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
			identityNote: 'Social uses the same P2P entity as Chat federation identity; no separate registration.',
		})
	})

	router.get('/api/parts/shells\\:social/posting-entities', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const selfEntityHash = resolveOperatorEntityHash(username)
		/** @type {object[]} */
		const entities = []
		if (selfEntityHash) {
			const profile = await getEntityProfile(username, selfEntityHash)
			entities.push({
				entityHash: selfEntityHash,
				displayName: profile?.name || selfEntityHash.slice(0, 8),
				kind: 'self',
			})
		}
		for (const { entityHash, charPartName } of listLocalAgentEntities(username)) {
			const profile = await getEntityProfile(username, entityHash)
			entities.push({
				entityHash,
				displayName: profile?.name || charPartName,
				charPartName,
				kind: 'agent',
			})
		}
		res.status(200).json({ entities })
	})
}

import { httpError } from '../../../../../../scripts/http_error.mjs'
import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
} from '../../../../../../scripts/p2p/personal_block.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { buildProfileFeedItems, buildLikedFeedItems, listReplies } from '../feed.mjs'
import { loadFollowing } from '../following.mjs'
import { ensureEntitySocialReady } from '../lib/bootstrap.mjs'
import { getEntityProfile } from '../lib/entityProfile.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'
import { updateSocialMeta } from '../socialMeta.mjs'
import { getTimelineMaterialized, maintainSocialTimeline } from '../timeline/materialize.mjs'

import { routeEntityHash } from './shared.mjs'

/**
 * 注册资料读路由与 meta 更新。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerProfileRoutes(router) {
	router.get('/api/parts/shells\\:social/profile/personal-lists', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntity = await resolveActingEntity(username, req.query?.actingEntityHash, { requireEntity: false })
		if (!actingEntity)
			return res.status(200).json({ entries: [] })
		const [blockedEntries, hiddenEntries] = await Promise.all([
			loadPersonalBlockEntries(actingEntity),
			loadPersonalHideEntries(actingEntity),
		])
		const entries = [
			...blockedEntries.map(entry => ({ ...entry, kind: 'block' })),
			...hiddenEntries.map(entry => ({ ...entry, kind: 'hide' })),
		]
		res.status(200).json({ entries })
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entityHash = routeEntityHash(req.params)
		const profile = await getEntityProfile(username, entityHash)
		const view = await getTimelineMaterialized(username, entityHash)
		const { following } = await loadFollowing(username)
		const isFollowing = following.includes(entityHash)
		res.status(200).json({
			entityHash,
			profile,
			postCount: view.posts.length,
			isFollowing,
			socialMeta: view.socialMeta,
		})
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await buildProfileFeedItems(username, routeEntityHash(req.params), {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/likes', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await buildLikedFeedItems(username, routeEntityHash(req.params)))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/following', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const view = await getTimelineMaterialized(username, routeEntityHash(req.params))
		res.status(200).json({ following: view.following })
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/replies/:postId', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entityHash = routeEntityHash(req.params)
		const postId = String(req.params.postId)
		if (!postId) throw httpError(400, 'invalid params')
		res.status(200).json({ replies: await listReplies(username, entityHash, postId) })
	})

	router.post('/api/parts/shells\\:social/profile/meta', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash)
		await ensureEntitySocialReady(username, actingEntity)
		const socialMeta = await updateSocialMeta(username, actingEntity, {
			exploreBlurb: req.body?.exploreBlurb,
			hideFromDiscovery: req.body?.hideFromDiscovery,
		})
		res.status(200).json({ socialMeta })
	})

	router.post('/api/parts/shells\\:social/timeline/:entityHash/maintain', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const snapshot = await maintainSocialTimeline(username, routeEntityHash(req.params))
		res.status(200).json({ checkpointEventId: snapshot.checkpoint_event_id })
	})
}

import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import {
	loadPersonalBlockEntries,
	loadPersonalHideEntries,
} from '../../../../../../scripts/p2p/personal_block.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { buildProfileFeedItems, buildLikedFeedItems, getEntityProfile, listReplies } from '../feed.mjs'
import { loadFollowing } from '../following.mjs'
import { ensureEntitySocialReady } from '../lib/bootstrap.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'
import { updateSocialMeta } from '../socialMeta.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'

/**
 * 注册资料读路由与 meta 更新。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerProfileRoutes(router) {
	router.get('/api/parts/shells\\:social/profile/personal-lists', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const acting = await resolveActingEntity(username, req.query?.actingEntityHash, { requireEntity: false })
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		if (!acting.actingEntity)
			return res.status(200).json({ entries: [] })
		const [blockedEntries, hiddenEntries] = await Promise.all([
			loadPersonalBlockEntries(acting.actingEntity),
			loadPersonalHideEntries(acting.actingEntity),
		])
		const entries = [
			...blockedEntries.map(entry => ({ ...entry, kind: 'block' })),
			...hiddenEntries.map(entry => ({ ...entry, kind: 'hide' })),
		]
		res.status(200).json({ entries })
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entityHash = String(req.params.entityHash).toLowerCase()
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
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
		const entityHash = String(req.params.entityHash).toLowerCase()
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
		res.status(200).json(await buildProfileFeedItems(username, entityHash))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/likes', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entityHash = String(req.params.entityHash).toLowerCase()
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
		res.status(200).json(await buildLikedFeedItems(username, entityHash))
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/following', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entityHash = String(req.params.entityHash).toLowerCase()
		if (!isEntityHash128(entityHash))
			return res.status(400).json({ error: 'invalid entityHash' })
		const view = await getTimelineMaterialized(username, entityHash)
		res.status(200).json({ following: view.following })
	})

	router.get('/api/parts/shells\\:social/profile/:entityHash/replies/:postId', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const entityHash = String(req.params.entityHash).toLowerCase()
		const postId = String(req.params.postId)
		if (!isEntityHash128(entityHash) || !postId)
			return res.status(400).json({ error: 'invalid params' })
		res.status(200).json({ replies: await listReplies(username, entityHash, postId) })
	})

	router.post('/api/parts/shells\\:social/profile/meta', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const acting = await resolveActingEntity(username, req.body?.actingEntityHash)
		if (acting.error)
			return res.status(acting.status).json({ error: acting.error })
		await ensureEntitySocialReady(username, acting.actingEntity)
		const socialMeta = await updateSocialMeta(username, acting.actingEntity, {
			exploreBlurb: req.body?.exploreBlurb,
			hideFromDiscovery: req.body?.hideFromDiscovery,
		})
		res.status(200).json({ socialMeta })
	})
}

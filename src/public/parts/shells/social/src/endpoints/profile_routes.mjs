import { randomUUID } from 'node:crypto'

import { setEntityBlocked } from '../../../../../../scripts/p2p/blocklist.mjs'
import { resolveOperatorEntityHash } from '../../../../../../scripts/p2p/entity/replica.mjs'
import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import { ensureFederationDefaults } from '../../../../../../scripts/p2p/federation/identity.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth.mjs'
import { dispatchFollowEvent, dispatchPostFollowerUpdates, dispatchPostMentions } from '../dispatch.mjs'
import { buildProfileFeedItems, getEntityProfile, listReplies } from '../feed.mjs'
import { setFollow, loadFollowing } from '../following.mjs'
import { autoApproveFollower } from '../vault_crypto/followApprove.mjs'
import { buildFollowApprovePayload, maybeEncryptPostContent } from '../vault_crypto/vault.mjs'
import { ensureEntitySocialReady, ensureOperatorSocialReady } from '../lib/bootstrap.mjs'
import { resolveSocialEntity } from '../lib/entityResolve.mjs'
import { updateSocialMeta } from '../socialMeta.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { getTimelineMaterialized } from '../timeline/materialize.mjs'
import { syncTimelineForEntity } from '../timeline/sync.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

/**
 * 注册资料、发帖与互动相关路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerProfileRoutes(router) {
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

	router.post('/api/parts/shells\\:social/profile/post', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		await ensureOperatorSocialReady(username)
		const requested = String(req.body?.entityHash).toLowerCase()
		const operator = resolveOperatorEntityHash(username)
		let entityHash = operator
		let charId = req.body?.charId || null
		if (requested) {
			const resolved = resolveSocialEntity(requested, username)
			if (!resolved?.local || resolved.replicaUsername !== username)
				return res.status(403).json({ error: 'can only post as your operator or local agent entities' })
			entityHash = resolved.entityHash
			if (resolved.kind === 'agent') charId = resolved.charPartName
		}
		if (!entityHash)
			return res.status(403).json({ error: 'configure Chat federation identity first (same P2P entity as Social)' })
		await ensureEntitySocialReady(username, entityHash)
		const visibility = req.body?.visibility === 'followers' ? 'followers' : 'public'
		const postKeyId = randomUUID()
		const draftContent = {
			text: String(req.body?.text),
			mediaRefs: Array.isArray(req.body?.mediaRefs) ? req.body.mediaRefs : [],
			replyTo: req.body?.replyTo,
			quoteRef: req.body?.quoteRef,
			groupRef: req.body?.groupRef,
			lang: req.body?.lang || 'zh-CN',
			visibility,
		}
		const signed = await commitTimelineEvent(username, entityHash, {
			type: 'post',
			charId,
			content: await maybeEncryptPostContent(username, entityHash, postKeyId, draftContent, visibility),
		})
		await dispatchPostMentions(username, entityHash, signed)
		await dispatchPostFollowerUpdates(entityHash, signed)
		pushFeedUpdate(username, { type: 'post', entityHash, postId: signed.id })
		res.status(200).json({ event: signed })
	})

	router.post('/api/parts/shells\\:social/profile/follow', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			return res.status(400).json({ error: 'invalid entityHash' })
		const follow = req.body?.follow !== false
		await setFollow(username, target, follow, { rep_edge: req.body?.rep_edge ?? 1 })
		const self = resolveOperatorEntityHash(username)
		if (self && follow) {
			await dispatchFollowEvent(username, self, target)
			const targetEntity = resolveSocialEntity(target)
			if (targetEntity?.local && targetEntity.replicaUsername) {
				const followerPubKeyHex = ensureFederationDefaults(username).identityPubKeyHex
				if (followerPubKeyHex)
					await autoApproveFollower(targetEntity.replicaUsername, target, followerPubKeyHex)
			}
			await syncTimelineForEntity(username, target)
		}

		res.status(200).json({ entityHash: target, following: follow })
	})

	router.post('/api/parts/shells\\:social/profile/like', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = resolveOperatorEntityHash(username)
		if (!self) return res.status(403).json({ error: 'identity required' })
		const body = req.body
		const like = body.like !== false
		const event = await commitTimelineEvent(username, self, {
			type: like ? 'like' : 'unlike',
			content: {
				targetEntityHash: String(body.entityHash).toLowerCase(),
				targetPostId: String(body.postId),
			},
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/profile/repost', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = resolveOperatorEntityHash(username)
		if (!self) return res.status(403).json({ error: 'identity required' })
		const body = req.body
		const targetEntityHash = String(body.entityHash).toLowerCase()
		const targetPostId = String(body.postId)
		if (!isEntityHash128(targetEntityHash) || !targetPostId)
			return res.status(400).json({ error: 'invalid params' })
		const event = await commitTimelineEvent(username, self, {
			type: 'repost',
			content: { targetEntityHash, targetPostId, comment: String(body.comment) },
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/profile/post-delete', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = resolveOperatorEntityHash(username)
		if (!self) return res.status(403).json({ error: 'identity required' })
		const targetPostId = String(req.body?.postId)
		if (!targetPostId) return res.status(400).json({ error: 'postId required' })
		const event = await commitTimelineEvent(username, self, {
			type: 'post_delete',
			content: { targetPostId },
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/profile/block', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const target = String(req.body?.entityHash).toLowerCase()
		if (!isEntityHash128(target))
			return res.status(400).json({ error: 'invalid entityHash' })
		const blocked = await setEntityBlocked(username, target, req.body?.block !== false)
		res.status(200).json({ entityHash: target, blocked })
	})

	router.post('/api/parts/shells\\:social/profile/follow-approve', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = resolveOperatorEntityHash(username)
		const followerPubKeyHex = String(req.body?.followerPubKeyHex)
		if (!self || !followerPubKeyHex)
			return res.status(400).json({ error: 'invalid request' })
		const payload = await buildFollowApprovePayload(username, self, followerPubKeyHex)
		const event = await commitTimelineEvent(username, self, {
			type: 'follow_approve',
			content: payload,
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/profile/meta', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const self = resolveOperatorEntityHash(username)
		if (!self) return res.status(403).json({ error: 'identity required' })
		await ensureEntitySocialReady(username, self)
		const socialMeta = await updateSocialMeta(username, self, {
			exploreBlurb: req.body?.exploreBlurb,
			isProtected: req.body?.isProtected,
		})
		res.status(200).json({ socialMeta })
	})
}

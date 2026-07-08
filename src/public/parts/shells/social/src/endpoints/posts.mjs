import { randomUUID } from 'node:crypto'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { resolveSocialEntity } from '../../../../../../scripts/p2p/entity/hosting.mjs'
import { isEntityHash128 } from '../../../../../../scripts/p2p/entity_id.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { dispatchPostFollowerUpdates, dispatchPostMentions } from '../dispatch.mjs'
import { ensureEntitySocialReady, ensureOperatorSocialReady } from '../lib/bootstrap.mjs'
import { buildEmojiMediaRefsForPost } from '../lib/emojiPostEmbed.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'
import { commitTimelineEvent } from '../timeline/append.mjs'
import { maybeEncryptPostContent } from '../vault_crypto/vault.mjs'
import { pushFeedUpdate } from '../ws/feedHub.mjs'

/**
 * 注册帖文创建、删除与互动路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerPostsRoutes(router) {
	router.post('/api/parts/shells\\:social/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		await ensureOperatorSocialReady(username)
		const requested = req.body.entityHash?.toLowerCase() ?? ''
		let entityHash = await resolveActingEntity(username, req.body.actingEntityHash, {
			invalidMessage: 'can only post as your operator or local agent entities',
			missingMessage: 'configure Chat federation identity first (same P2P entity as Social)',
		})
		let charPartName = req.body.charPartName || null
		if (requested) {
			const resolved = await resolveSocialEntity(requested, username)
			if (!resolved?.local || resolved.replicaUsername !== username)
				throw httpError(403, 'can only post as your operator or local agent entities')
			entityHash = resolved.entityHash
			if (resolved.kind === 'agent') charPartName = resolved.charPartName
		}
		await ensureEntitySocialReady(username, entityHash)
		const visibility = req.body.visibility === 'followers' ? 'followers' : 'public'
		const draftContent = {
			text: String(req.body.text),
			mediaRefs: [
				...req.body.mediaRefs ?? [],
				...await buildEmojiMediaRefsForPost(username, String(req.body.text)),
			],
			replyTo: req.body.replyTo,
			quoteRef: req.body.quoteRef,
			groupRef: req.body.groupRef,
			lang: req.body.lang || 'zh-CN',
			visibility,
		}
		const signed = await commitTimelineEvent(username, entityHash, {
			type: 'post',
			charPartName,
			content: await maybeEncryptPostContent(username, entityHash, randomUUID(), draftContent, visibility),
		})
		await dispatchPostMentions(username, entityHash, signed)
		await dispatchPostFollowerUpdates(entityHash, signed)
		pushFeedUpdate(username, { type: 'post', entityHash, postId: signed.id })
		res.status(200).json({ event: signed })
	})

	router.delete('/api/parts/shells\\:social/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntity = await resolveActingEntity(username, req.body.actingEntityHash)
		const targetPostId = String(req.body.postId)
		if (!targetPostId) throw httpError(400, 'postId required')
		const event = await commitTimelineEvent(username, actingEntity, {
			type: 'post_delete',
			content: { targetPostId },
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/like', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.params.entityHash).toLowerCase()
		const targetPostId = String(req.params.postId)
		if (!isEntityHash128(targetEntityHash) || !targetPostId)
			throw httpError(400, 'invalid params')
		if (!await isKnownSocialTarget(username, targetEntityHash))
			throw httpError(400, 'unknown entity')
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash)
		const like = req.body?.like !== false
		const event = await commitTimelineEvent(username, actingEntity, {
			type: like ? 'like' : 'unlike',
			content: { targetEntityHash, targetPostId },
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/repost', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.params.entityHash).toLowerCase()
		const targetPostId = String(req.params.postId)
		if (!isEntityHash128(targetEntityHash) || !targetPostId)
			throw httpError(400, 'invalid params')
		if (!await isKnownSocialTarget(username, targetEntityHash))
			throw httpError(400, 'unknown entity')
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash)
		const event = await commitTimelineEvent(username, actingEntity, {
			type: 'repost',
			content: {
				targetEntityHash,
				targetPostId,
				comment: String(req.body?.comment || ''),
			},
		})
		res.status(200).json({ event })
	})
}

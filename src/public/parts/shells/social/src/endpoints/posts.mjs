import { randomUUID } from 'node:crypto'

import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { resolveSocialEntity } from '../federation/hosting.mjs'
import { buildPostFeedItem } from '../feed/buildItem.mjs'
import { createFeedItemBuildContext } from '../feed/iterate.mjs'
import { ensureEntitySocialReady, ensureOperatorSocialReady } from '../lib/bootstrap.mjs'
import { buildEmojiMediaRefsForPost } from '../lib/emojiPostEmbed.mjs'
import { isKnownSocialTarget } from '../lib/entityTarget.mjs'
import { assertPollVoteAllowed, normalizePollDraft } from '../lib/poll.mjs'
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
		const entityHash = await resolveActingEntity(
			username,
			req.body?.actingEntityHash ?? req.body?.entityHash ?? req.query.actingEntityHash,
			{
				invalidMessage: 'can only post as your operator or local agent entities',
				missingMessage: 'configure Chat federation identity first (same P2P entity as Social)',
			},
		)
		const resolved = await resolveSocialEntity(entityHash, username)
		const charPartName = req.body.charPartName
			|| (resolved?.kind === 'agent' ? resolved.charPartName : null)
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
			...req.body.contentWarning ? { contentWarning: String(req.body.contentWarning).trim().slice(0, 200) } : {},
		}
		if (req.body.poll) 
			try {
				draftContent.poll = normalizePollDraft(req.body.poll)
			}
			catch (err) {
				throw httpError(400, err?.message || 'invalid poll')
			}
		
		const signed = await commitTimelineEvent(username, entityHash, {
			type: 'post',
			charPartName,
			content: await maybeEncryptPostContent(username, entityHash, randomUUID(), draftContent, visibility),
		})
		const itemContext = await createFeedItemBuildContext(username, new Set([entityHash]), entityHash)
		const item = await buildPostFeedItem(username, entityHash, { ...signed, postId: signed.id }, itemContext)
		pushFeedUpdate(username, { type: 'post', item })
		res.status(200).json({ event: signed })
	})

	router.delete('/api/parts/shells\\:social/posts', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash ?? req.query.actingEntityHash)
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
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash ?? req.query.actingEntityHash)
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
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash ?? req.query.actingEntityHash)
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

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/poll-vote', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.params.entityHash).toLowerCase()
		const targetPostId = String(req.params.postId)
		if (!isEntityHash128(targetEntityHash) || !targetPostId)
			throw httpError(400, 'invalid params')
		if (!await isKnownSocialTarget(username, targetEntityHash))
			throw httpError(400, 'unknown entity')
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash ?? req.query.actingEntityHash)
		let choices
		try {
			choices = await assertPollVoteAllowed(username, targetEntityHash, targetPostId, req.body?.choices)
		}
		catch (err) {
			throw httpError(400, err?.message || 'invalid poll vote')
		}
		const event = await commitTimelineEvent(username, actingEntity, {
			type: 'poll_vote',
			content: { targetEntityHash, targetPostId, choices },
		})
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/edit', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.params.entityHash).toLowerCase()
		const targetPostId = String(req.params.postId)
		if (!isEntityHash128(targetEntityHash) || !targetPostId)
			throw httpError(400, 'invalid params')
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash ?? req.query.actingEntityHash)
		if (actingEntity !== targetEntityHash)
			throw httpError(403, 'can only edit own posts')
		const { getTimelineMaterialized } = await import('../timeline/materialize.mjs')
		const { maybeDecryptPostContent } = await import('../vault_crypto/vault.mjs')
		const view = await getTimelineMaterialized(username, actingEntity)
		const post = view.postById[targetPostId]
		if (!post) throw httpError(404, 'post not found')
		const decrypted = await maybeDecryptPostContent(username, actingEntity, post.content) || post.content || {}
		const visibility = decrypted.visibility || post.content?.visibility || 'public'
		const draftContent = {
			targetPostId,
			text: String(req.body.text ?? decrypted.text ?? ''),
			mediaRefs: req.body.mediaRefs ?? decrypted.mediaRefs,
			lang: req.body.lang || decrypted.lang || 'zh-CN',
			...req.body.contentWarning !== undefined
				? { contentWarning: String(req.body.contentWarning).trim().slice(0, 200) }
				: decrypted.contentWarning ? { contentWarning: decrypted.contentWarning } : {},
		}
		const event = await commitTimelineEvent(username, actingEntity, {
			type: 'post_edit',
			content: await maybeEncryptPostContent(username, actingEntity, targetPostId, draftContent, visibility),
		})
		res.status(200).json({ event })
	})
}

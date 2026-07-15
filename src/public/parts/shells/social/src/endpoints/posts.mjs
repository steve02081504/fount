import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { routeEntityHash, socialClientFromReq } from './shared.mjs'

/**
 * 注册帖文创建、删除与互动路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerPostsRoutes(router) {
	router.post('/api/parts/shells\\:social/posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(req.body || {})
		if (post?.scheduled)
			return res.status(200).json({ scheduled: true, scheduledId: post.scheduledId, publishAt: post.publishAt })
		res.status(200).json({ event: post.event })
	})

	router.get('/api/parts/shells\\:social/posts/scheduled', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json({ items: await client.listScheduledPosts() })
	})

	router.delete('/api/parts/shells\\:social/posts/scheduled/:scheduledId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const removed = await client.cancelScheduledPost(String(req.params.scheduledId || ''))
		if (!removed) throw httpError(404, 'scheduled post not found')
		res.status(200).json({ cancelled: true, scheduledId: removed.scheduledId })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/feature-reply', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		const feature = req.body?.feature !== false
		res.status(200).json({
			event: await post.featureReply({
				replierEntityHash: req.body?.replierEntityHash,
				replyPostId: req.body?.replyPostId,
				feature,
			}),
		})
	})

	router.delete('/api/parts/shells\\:social/posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const postId = String(req.body?.postId || '')
		if (!postId) throw httpError(400, 'postId required')
		const entityHash = String(req.body?.entityHash || client.entityHash).trim().toLowerCase()
		const post = await client.post(entityHash, postId)
		res.status(200).json({ event: await post.delete() })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/like', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		const event = req.body?.like === false ? await post.unlike() : await post.like()
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/dislike', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		const event = req.body?.dislike === false ? await post.undislike() : await post.dislike()
		res.status(200).json({ event })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/repost', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		res.status(200).json({ event: await post.repost(req.body?.comment) })
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/poll-vote', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		try {
			const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
			res.status(200).json({ event: await post.pollVote(req.body?.choices) })
		}
		catch (err) {
			throw httpError(400, err?.message || 'invalid poll vote')
		}
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/edit', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		res.status(200).json({
			event: await post.edit({
				text: req.body?.text,
				mediaRefs: req.body?.mediaRefs,
				locale: req.body?.locale,
				contentWarning: req.body?.contentWarning,
			}),
		})
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/notes', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		res.status(200).json({ event: await post.addNote(req.body?.text) })
	})

	router.get('/api/parts/shells\\:social/posts/:entityHash/:postId/notes', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		res.status(200).json(await post.notes())
	})

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/notes/:noteEventId/vote', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const post = await client.post(routeEntityHash(req.params), String(req.params.postId))
		res.status(200).json({
			event: await post.voteNote(String(req.params.noteEventId), req.body?.helpful !== false),
		})
	})
}

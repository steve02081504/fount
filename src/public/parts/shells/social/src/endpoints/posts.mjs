import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { routeEntityHash, socialJson } from './shared.mjs'

/**
 * @param {import('npm:express').Request} req 请求
 * @param {object} client SocialClient
 * @returns {Promise<object>} post handle
 */
function postFromParams(req, client) {
	return client.post(routeEntityHash(req.params), String(req.params.postId))
}

/**
 * 注册帖文创建、删除与互动路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerPostsRoutes(router) {
	router.get('/api/parts/shells\\:social/posts/:entityHash/:postId', authenticate, socialJson(async (req, { client }) => {
		const item = await client.postFeedItem(routeEntityHash(req.params), String(req.params.postId))
		if (!item) throw httpError(404, 'post not found')
		return { item }
	}))

	router.post('/api/parts/shells\\:social/posts', authenticate, socialJson(async (req, { client }) => {
		const post = await client.post(req.body || {})
		if (post?.scheduled)
			return { scheduled: true, scheduledId: post.scheduledId, publishAt: post.publishAt }
		return { event: post.event }
	}))

	router.get('/api/parts/shells\\:social/posts/scheduled', authenticate, socialJson(async (_req, { client }) => ({
		items: await client.listScheduledPosts(),
	})))

	router.delete('/api/parts/shells\\:social/posts/scheduled/:scheduledId', authenticate, socialJson(async (req, { client }) => {
		const removed = await client.cancelScheduledPost(String(req.params.scheduledId || ''))
		if (!removed) throw httpError(404, 'scheduled post not found')
		return { cancelled: true, scheduledId: removed.scheduledId }
	}))

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/feature-reply', authenticate, socialJson(async (req, { client }) => {
		const post = await postFromParams(req, client)
		return {
			event: await post.featureReply({
				replierEntityHash: req.body?.replierEntityHash,
				replyPostId: req.body?.replyPostId,
				feature: req.body?.feature !== false,
			}),
		}
	}))

	router.delete('/api/parts/shells\\:social/posts', authenticate, socialJson(async (req, { client }) => {
		const postId = String(req.body?.postId || '')
		if (!postId) throw httpError(400, 'postId required')
		const entityHash = String(req.body?.entityHash || client.entityHash).trim().toLowerCase()
		const post = await client.post(entityHash, postId)
		return { event: await post.delete() }
	}))

	for (const { path, flag, on, off } of [
		{ path: 'like', flag: 'like', on: 'like', off: 'unlike' },
		{ path: 'dislike', flag: 'dislike', on: 'dislike', off: 'undislike' },
	]) 
		router.post(`/api/parts/shells\\:social/posts/:entityHash/:postId/${path}`, authenticate, socialJson(async (req, { client }) => {
			const post = await postFromParams(req, client)
			return {
				event: req.body?.[flag] === false ? await post[off]() : await post[on](),
			}
		}))
	

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/repost', authenticate, socialJson(async (req, { client }) => {
		const post = await postFromParams(req, client)
		return { event: await post.repost(req.body?.comment) }
	}))

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/poll-vote', authenticate, socialJson(async (req, { client }) => {
		try {
			const post = await postFromParams(req, client)
			return { event: await post.pollVote(req.body?.choices) }
		}
		catch (err) {
			throw httpError(400, err?.message || 'invalid poll vote')
		}
	}))

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/edit', authenticate, socialJson(async (req, { client }) => {
		const post = await postFromParams(req, client)
		return {
			event: await post.edit({
				text: req.body?.text,
				mediaRefs: req.body?.mediaRefs,
				locale: req.body?.locale,
				contentWarning: req.body?.contentWarning,
			}),
		}
	}))

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/notes', authenticate, socialJson(async (req, { client }) => {
		const post = await postFromParams(req, client)
		return { event: await post.addNote(req.body?.text) }
	}))

	router.get('/api/parts/shells\\:social/posts/:entityHash/:postId/notes', authenticate, socialJson(async (req, { client }) => {
		const post = await postFromParams(req, client)
		return post.notes()
	}))

	router.post('/api/parts/shells\\:social/posts/:entityHash/:postId/notes/:noteEventId/vote', authenticate, socialJson(async (req, { client }) => {
		const post = await postFromParams(req, client)
		return {
			event: await post.voteNote(String(req.params.noteEventId), req.body?.helpful !== false),
		}
	}))
}

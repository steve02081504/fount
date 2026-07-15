import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 话题订阅与话题帖流。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTopicsRoutes(router) {
	router.post('/api/parts/shells\\:social/topics/follow', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const tag = String(req.body?.tag || '').trim()
		if (!tag) throw httpError(400, 'tag required')
		res.status(200).json(await client.followTopic(tag, req.body?.follow !== false))
	})

	router.get('/api/parts/shells\\:social/topics/followed', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.followedTopics())
	})

	router.get('/api/parts/shells\\:social/topics/:tag/posts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const tag = String(req.params.tag || '').trim()
		if (!tag) throw httpError(400, 'tag required')
		res.status(200).json(await client.topicPosts(tag, {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})
}

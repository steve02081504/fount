import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册发帖草稿箱路由（client.drafts.*）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDraftsRoutes(router) {
	router.get('/api/parts/shells\\:social/drafts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.drafts.list())
	})

	router.get('/api/parts/shells\\:social/drafts/:draftId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const draftId = String(req.params.draftId || '').trim()
		if (!draftId) throw httpError(400, 'draftId required')
		res.status(200).json(await client.drafts.get(draftId))
	})

	router.post('/api/parts/shells\\:social/drafts', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.drafts.upsert(req.body || {}))
	})

	router.delete('/api/parts/shells\\:social/drafts/:draftId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const draftId = String(req.params.draftId || '').trim()
		if (!draftId) throw httpError(400, 'draftId required')
		res.status(200).json(await client.drafts.delete(draftId))
	})
}

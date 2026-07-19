import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/**
 * 注册发帖草稿箱路由（client.drafts.*）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerDraftsRoutes(router) {
	router.get('/api/parts/shells\\:social/drafts', authenticate, socialJson((_req, { client }) => client.drafts.list()))

	router.get('/api/parts/shells\\:social/drafts/:draftId', authenticate, socialJson(async (req, { client }) => {
		const draftId = String(req.params.draftId || '').trim()
		if (!draftId) throw httpError(400, 'draftId required')
		return client.drafts.get(draftId)
	}))

	router.post('/api/parts/shells\\:social/drafts', authenticate, socialJson((req, { client }) =>
		client.drafts.upsert(req.body || {})))

	router.delete('/api/parts/shells\\:social/drafts/:draftId', authenticate, socialJson(async (req, { client }) => {
		const draftId = String(req.params.draftId || '').trim()
		if (!draftId) throw httpError(400, 'draftId required')
		return client.drafts.delete(draftId)
	}))
}

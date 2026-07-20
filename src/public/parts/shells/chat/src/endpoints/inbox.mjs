import { authenticate } from '../../../../../../server/auth/index.mjs'
import { CHAT_API_PREFIX } from '../group/routes/path.mjs'

import { chatClientFromReq } from './shared.mjs'

/**
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerInboxRoutes(router) {
	router.get(`${CHAT_API_PREFIX}/inbox`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		const kinds = req.query.kinds
			? String(req.query.kinds).split(',').map(kind => kind.trim()).filter(Boolean)
			: undefined
		res.status(200).json(await client.inbox.list({
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			kinds,
		}))
	})

	router.get(`${CHAT_API_PREFIX}/inbox/seen`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({ seenAt: await client.inbox.seenAt() })
	})

	router.put(`${CHAT_API_PREFIX}/inbox/seen`, authenticate, async (req, res) => {
		const { client } = await chatClientFromReq(req)
		res.status(200).json({ seenAt: await client.inbox.setSeenAt(req.body?.at) })
	})
}

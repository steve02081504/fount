import { authenticate } from '../../../../../../server/auth/index.mjs'
import { appendDwellSignals } from '../engagement/dwell.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 本地隐私信号路由（不联邦）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSignalsRoutes(router) {
	router.post('/api/parts/shells\\:social/signals/dwell', authenticate, async (req, res) => {
		const { username, client } = await socialClientFromReq(req)
		const rows = Array.isArray(req.body?.entries) ? req.body.entries : Array.isArray(req.body) ? req.body : []
		res.status(200).json(await appendDwellSignals(username, client.entityHash, rows.slice(0, 50)))
	})
}

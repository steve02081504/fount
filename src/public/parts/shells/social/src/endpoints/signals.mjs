import { authenticate } from '../../../../../../server/auth/index.mjs'
import { appendDwellSignals } from '../engagement/dwell.mjs'

import { socialJson } from './shared.mjs'

/**
 * 本地隐私信号路由（不联邦）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerSignalsRoutes(router) {
	router.post('/api/parts/shells\\:social/signals/dwell', authenticate, socialJson((req, { username, client }) => {
		const rows = Array.isArray(req.body?.entries) ? req.body.entries : Array.isArray(req.body) ? req.body : []
		return appendDwellSignals(username, client.entityHash, rows.slice(0, 50))
	}))
}

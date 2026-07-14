import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册治理相关路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerGovernanceRoutes(router) {
	router.post('/api/parts/shells\\:social/governance/report', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const targetEntityHash = String(req.body?.targetEntityHash || '').toLowerCase()
		if (!isEntityHash128(targetEntityHash))
			throw httpError(400, 'invalid targetEntityHash')
		const report = await client.report({
			targetEntityHash,
			targetPostId: req.body?.targetPostId,
			reason: req.body?.reason,
			category: req.body?.category,
		})
		res.status(200).json({ report })
	})

	router.get('/api/parts/shells\\:social/governance/reports', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.listReports({
			limit: Number(req.query.limit) || 50,
		}))
	})

	router.post('/api/parts/shells\\:social/governance/reports/resolve', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		try {
			const resolved = await client.resolveReport({
				reportId: req.body?.reportId,
				action: req.body?.action,
			})
			res.status(200).json({ resolved })
		}
		catch (err) {
			throw httpError(400, err?.message || 'resolve failed')
		}
	})
}

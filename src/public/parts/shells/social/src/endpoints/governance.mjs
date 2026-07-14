import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { listReceivedReports, resolveReport, submitReport } from '../governance/report.mjs'
import { resolveActingEntity } from '../lib/resolveActingEntity.mjs'

/**
 * 注册治理相关路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerGovernanceRoutes(router) {
	router.post('/api/parts/shells\\:social/governance/report', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const targetEntityHash = String(req.body?.targetEntityHash || '').toLowerCase()
		if (!isEntityHash128(targetEntityHash))
			throw httpError(400, 'invalid targetEntityHash')
		const reporterEntityHash = await resolveActingEntity(
			username,
			req.body?.actingEntityHash ?? req.query.actingEntityHash,
		)
		const report = await submitReport(username, {
			targetEntityHash,
			targetPostId: req.body?.targetPostId,
			reason: req.body?.reason,
			category: req.body?.category,
			reporterEntityHash,
		})
		res.status(200).json({ report })
	})

	router.get('/api/parts/shells\\:social/governance/reports', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await listReceivedReports(username, {
			limit: Number(req.query.limit) || 50,
		}))
	})

	router.post('/api/parts/shells\\:social/governance/reports/resolve', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const actingEntity = await resolveActingEntity(username, req.body?.actingEntityHash ?? req.query.actingEntityHash)
		try {
			const resolved = await resolveReport(username, actingEntity, {
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

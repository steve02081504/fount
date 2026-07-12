import { httpError } from '../../../../../../scripts/http_error.mjs'
import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { listReceivedReports, submitReport } from '../governance/report.mjs'

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
		const reporterEntityHash = (await resolveOperatorEntityHashForUser(username))?.toLowerCase()
		if (!reporterEntityHash)
			throw httpError(400, 'configure federation identity first')
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
}

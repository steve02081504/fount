import { isEntityHash128 } from 'npm:@steve02081504/fount-p2p/core/entity_id'

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 注册 vault 文件相关路由（client.vault.*）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerVaultRoutes(router) {
	router.post('/api/parts/shells\\:social/files', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.vault.registerFile(req.body))
	})

	router.get('/api/parts/shells\\:social/files/:shareId', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const owner = String(req.query.owner || client.entityHash || '').toLowerCase()
		if (!isEntityHash128(owner))
			throw httpError(400, 'invalid owner')
		const entry = await client.vault.getFile(String(req.params.shareId), owner)
		if (!entry) throw httpError(404, 'not found')
		res.status(200).json({ entry })
	})
}

import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialClientFromReq } from './shared.mjs'

/**
 * 偏好 / 口味标签 HTTP（人与 agent 同入口；HTTP 固定 operator，agent 用 SocialClient）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTasteRoutes(router) {
	router.get('/api/parts/shells\\:social/taste', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.taste.get({ locale: String(req.query.locale || 'zh-CN') }))
	})

	router.put('/api/parts/shells\\:social/taste', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.taste.update(req.body || {}))
	})

	router.post('/api/parts/shells\\:social/taste/rebuild', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.taste.rebuild())
	})

	router.post('/api/parts/shells\\:social/taste/names', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		const tagHash = String(req.body?.tagHash || '').trim()
		const label = String(req.body?.label || '').trim()
		const locale = String(req.body?.locale || 'zh-CN').trim()
		if (!tagHash || !label) throw httpError(400, 'tagHash and label required')
		res.status(200).json(await client.taste.setName({ tagHash, label, locale }))
	})

	router.delete('/api/parts/shells\\:social/taste/aliases/:fromTag', authenticate, async (req, res) => {
		const { client } = await socialClientFromReq(req)
		res.status(200).json(await client.taste.revokeAlias(String(req.params.fromTag || '')))
	})
}

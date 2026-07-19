import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/**
 * 偏好 / 口味标签 HTTP（人与 agent 同入口；HTTP 固定 operator，agent 用 SocialClient）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerTasteRoutes(router) {
	router.get('/api/parts/shells\\:social/taste', authenticate, socialJson((req, { client }) =>
		client.taste.get({ locale: String(req.query.locale || 'zh-CN') })))

	router.put('/api/parts/shells\\:social/taste', authenticate, socialJson((req, { client }) =>
		client.taste.update(req.body || {})))

	router.post('/api/parts/shells\\:social/taste/rebuild', authenticate, socialJson((_req, { client }) =>
		client.taste.rebuild()))

	router.post('/api/parts/shells\\:social/taste/names', authenticate, socialJson(async (req, { client }) => {
		const tagHash = String(req.body?.tagHash || '').trim()
		const label = String(req.body?.label || '').trim()
		const locale = String(req.body?.locale || 'zh-CN').trim()
		if (!tagHash || !label) throw httpError(400, 'tagHash and label required')
		return client.taste.setName({ tagHash, label, locale })
	}))

	router.delete('/api/parts/shells\\:social/taste/aliases/:fromTag', authenticate, socialJson((req, { client }) =>
		client.taste.revokeAlias(String(req.params.fromTag || ''))))
}

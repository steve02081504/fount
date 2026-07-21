import { httpError } from '../../../../../../scripts/http_error.mjs'
import { authenticate } from '../../../../../../server/auth/index.mjs'

import { socialJson } from './shared.mjs'

/**
 * 注册通知路由（SocialClient 薄封装；仅 operator）。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerNotificationRoutes(router) {
	router.get('/api/parts/shells\\:social/notifications', authenticate, socialJson((req, { client }) =>
		client.notifications({
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
			types: req.query.types,
		})))

	router.get('/api/parts/shells\\:social/notifications/seen', authenticate, socialJson(async (_req, { client }) => ({
		seenAt: await client.notificationsSeenAt(),
		viewerEntityHash: client.entityHash,
	})))

	router.put('/api/parts/shells\\:social/notifications/seen', authenticate, socialJson(async (req, { client }) => {
		if (!client.entityHash) throw httpError(400, 'identity required')
		const seenAt = await client.setNotificationsSeenAt(req.body?.at)
		return { seenAt, viewerEntityHash: client.entityHash }
	}))
}

import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { buildNotifications } from '../notifications.mjs'

/**
 * 注册通知路由。
 * @param {import('npm:express').Router} router Express 路由
 * @returns {void}
 */
export function registerNotificationRoutes(router) {
	router.get('/api/parts/shells\\:social/notifications', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		res.status(200).json(await buildNotifications(username, {
			limit: Number(req.query.limit) || 30,
			cursor: req.query.cursor ? String(req.query.cursor) : undefined,
		}))
	})
}

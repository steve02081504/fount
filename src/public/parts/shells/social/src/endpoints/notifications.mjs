import { authenticate, getUserByReq } from '../../../../../../server/auth/index.mjs'
import { resolveOperatorEntityHashForUser as resolveOperatorEntityHash } from '../../../../../../server/p2p_server/operator_identity.mjs'
import { getNotificationsSeenAt, parseNotificationTypesFilter, setNotificationsSeenAt } from '../inbox.mjs'
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
			types: parseNotificationTypesFilter(req.query.types),
		}))
	})

	router.get('/api/parts/shells\\:social/notifications/seen', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
		if (!viewerEntityHash)
			return res.status(200).json({ seenAt: 0, viewerEntityHash: null })
		res.status(200).json({
			seenAt: getNotificationsSeenAt(username, viewerEntityHash),
			viewerEntityHash,
		})
	})

	router.put('/api/parts/shells\\:social/notifications/seen', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const viewerEntityHash = (await resolveOperatorEntityHash(username))?.toLowerCase() || null
		if (!viewerEntityHash)
			return res.status(400).json({ error: 'identity required' })
		const at = Number(req.body?.at) || Date.now()
		setNotificationsSeenAt(username, viewerEntityHash, at)
		res.status(200).json({ seenAt: at, viewerEntityHash })
	})
}

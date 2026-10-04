import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'

import { expandHomeRegistry } from './home.mjs'
import { getInvitationProgress, inviteSelf, startInvitation } from './invitation.mjs'

/**
 * 为主页功能设置API端点。
 * @param {import('npm:websocket-express').Router} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:home/invitation', authenticate, async (req, res) => {
		res.status(200).json(await getInvitationProgress(getUserByReq(req).username))
	})
	router.post('/api/parts/shells\\:home/invitation', authenticate, async (req, res) => {
		try { res.status(200).json(await startInvitation(getUserByReq(req).username, req.body?.link)) }
		catch (error) { res.status(400).json({ error: error.message }) }
	})
	router.post('/api/parts/shells\\:home/invitation/self', authenticate, async (req, res) => {
		res.status(200).json(inviteSelf())
	})
	router.get('/api/parts/shells\\:home/gethomeregistry', authenticate, async (req, res) => {
		const { username } = getUserByReq(req)
		const expandedRegistry = await expandHomeRegistry(username)
		res.status(200).json(expandedRegistry)
	})
}

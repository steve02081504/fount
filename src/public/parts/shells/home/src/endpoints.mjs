import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { expandHomeRegistry } from './home.mjs'

/**
 * 为主页功能设置API端点。
 * @param {import('npm:websocket-express').Router} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells:home/gethomeregistry', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const expandedRegistry = await expandHomeRegistry(username)
		res.status(200).json(expandedRegistry)
	})
}

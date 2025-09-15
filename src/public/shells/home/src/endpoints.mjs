import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

import { expandHomeRegistry } from './home.mjs'

/**
 * @param {import('npm:websocket-express').Router} router
 */
export function setEndpoints(router) {
	router.get('/api/shells/home/gethomeregistry', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const expandedRegistry = await expandHomeRegistry(username)
		res.status(200).json(expandedRegistry)
	})
}

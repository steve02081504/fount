import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { save_config } from '../../../../../server/server.mjs'
import { expandHomeRegistry } from './home.mjs'

/**
 * @param {import('npm:express').Router} router
 */
export function setEndpoints(router) {
	router.get('/api/shells/home/gethomeregistry', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const expandedRegistry = await expandHomeRegistry(username)
		res.status(200).json(expandedRegistry)
	})

	router.get('/api/shells/home/getdefaultparts', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		res.status(200).json(user.defaultParts || {})
	})

	router.post('/api/shells/home/setdefault', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		const { parttype, partname } = req.body

		user.defaultParts ??= {}

		if (!partname)
			delete user.defaultParts[parttype]
		else
			user.defaultParts[parttype] = partname

		save_config()
		res.status(200).json({ message: 'success' })
	})
}

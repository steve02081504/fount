import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { expandHomeRegistry } from './home.mjs'
/**
 * @param {import('npm:express').Router} router
 */
export function setEndpoints(router) {
	router.post('/api/setlocale', authenticate, async (req, res) => {
		const user = await getUserByToken(req.cookies.accessToken)
		const { locale } = req.body
		user.locale = locale
		console.log(user.username + ' set locale to ' + locale)
		res.status(200).json({ message: 'setlocale ok' })
	})
	router.get('/api/gethomeregistry', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const expandedRegistry = await expandHomeRegistry(username)
		res.status(200).json(expandedRegistry)
	})
}

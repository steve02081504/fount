import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { expandHomeRegistry } from './home.mjs'
/**
 * @param {import('npm:express').Express} app
 */
export function setEndpoints(app) {
	app.post('/api/setlocale', authenticate, async (req, res) => {
		const user = await getUserByToken(req.cookies.accessToken)
		const { locale } = req.body
		user.locale = locale
		console.log(user.username + ' set locale to ' + locale)
		res.status(200).json({ message: 'setlocale ok' })
	})
	app.get('/api/gethomeregistry', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const expandedRegistry = await expandHomeRegistry(username)
		res.status(200).json(expandedRegistry)
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/setlocale', (req, res) => {
		res.status(404)
	})
	app.get('/api/gethomeregistry', (req, res) => {
		res.status(404)
	})
}

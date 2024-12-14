import { authenticate, getUserByToken } from "../../../../../server/auth.mjs"

export function setEndpoints(app) {
	app.post('/api/shells/install/new', authenticate, async (req, res) => {
		// not implement
		res.status(500).json({ message: 'not implement' })
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/shells/install/new', (req, res) => {
		res.status(404)
	})
}

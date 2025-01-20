import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { getPartData, setPartData } from './manager.mjs'

export function setEndpoints(app) {
	app.post('/api/shells/config/getdata', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByToken(req.cookies.accessToken)
			const data = await getPartData(username, req.body.parttype, req.body.partname)
			res.status(200).json(data)
		} catch (error) {
			res.status(500).json({ error: error.message })
		}
	})

	app.post('/api/shells/config/setdata', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByToken(req.cookies.accessToken)
			await setPartData(username, req.body.parttype, req.body.partname, req.body.data)
			res.status(200).json({ message: 'new data setted' })
		} catch (error) {
			res.status(500).json({ error: error.message })
		}
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/shells/config/getdata', (req, res) => {
		res.status(404)
	})
	app.post('/api/shells/config/setdata', (req, res) => {
		res.status(404)
	})
}

import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { getPartData, setPartData } from './manager.mjs'

export function setEndpoints(router) {
	router.post('/api/shells/config/getdata', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const data = await getPartData(username, req.body.parttype, req.body.partname)
		res.status(200).json(data)
	})

	router.post('/api/shells/config/setdata', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		await setPartData(username, req.body.parttype, req.body.partname, req.body.data)
		res.status(200).json({ message: 'new data setted' })
	})
}

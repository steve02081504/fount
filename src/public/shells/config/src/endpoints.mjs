import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

import { getPartData, setPartData, getPartDisplayContent } from './manager.mjs'

export function setEndpoints(router) {
	router.get('/api/shells/config/getdata', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname } = req.query
		const data = await getPartData(username, parttype, partname)
		res.status(200).json(data)
	})

	router.post('/api/shells/config/setdata', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		await setPartData(username, req.body.parttype, req.body.partname, req.body.data)
		res.status(200).json({ message: 'new data setted' })
	})

	router.get('/api/shells/config/getPartDisplay', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname } = req.query
		const content = await getPartDisplayContent(username, parttype, partname)
		res.status(200).json(content)
	})
}

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { getPartData, setPartData, getPartDisplayContent } from './manager.mjs'

/**
 * 为组件配置功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:config/getdata', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.query.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		const data = await getPartData(username, partpath)
		res.status(200).json(data)
	})

	router.post('/api/parts/shells\\:config/setdata', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.body.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		await setPartData(username, partpath, req.body.data)
		res.status(200).json({ message: 'new data setted' })
	})

	router.get('/api/parts/shells\\:config/getPartDisplay', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.query.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		const content = await getPartDisplayContent(username, partpath)
		res.status(200).json(content)
	})
}

import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { getAISourceFile, saveAISourceFile, addAISourceFile, deleteAISourceFile, getConfigTemplate, getConfigDisplay } from './manager.mjs'

export function setEndpoints(router) {
	// fount自带的/api/getlist/AIsources已经可以返回列表了，不用再次实现
	router.get('/api/shells/AIsourceManage/getfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const data = await getAISourceFile(username, req.query.AISourceFile)
		res.status(200).json(data)
	})
	router.post('/api/shells/AIsourceManage/setfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		await saveAISourceFile(username, req.body.AISourceFile, req.body.data)
		res.status(200).json({ message: 'File saved successfully' })
	})
	router.post('/api/shells/AIsourceManage/addfile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		await addAISourceFile(username, req.body.AISourceFile)
		res.status(200).json({ message: 'File added successfully' })
	})
	router.post('/api/shells/AIsourceManage/deletefile', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		await deleteAISourceFile(username, req.body.AISourceFile)
		res.status(200).json({ message: 'File deleted successfully' })
	})
	router.get('/api/shells/AIsourceManage/getConfigTemplate', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const template = await getConfigTemplate(username, req.query.generator)
		res.status(200).json(template)
	})
	router.get('/api/shells/AIsourceManage/getConfigDisplay', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const content = await getConfigDisplay(username, req.query.generator)
		res.status(200).json(content)
	})
}

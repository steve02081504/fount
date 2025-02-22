import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { getAISourceFile, saveAISourceFile, addAISourceFile, deleteAISourceFile, getConfigTemplate } from './manager.mjs'

export function setEndpoints(router) {
	// fount自带的/api/getlist/AIsources已经可以返回列表了，不用再次实现
	router.post('/api/shells/AIsourceManage/getfile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const data = await getAISourceFile(username, req.body.AISourceFile)
		res.status(200).json(data)
	})
	router.post('/api/shells/AIsourceManage/setfile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		await saveAISourceFile(username, req.body.AISourceFile, req.body.data)
		res.status(200).json({ message: 'File saved successfully' })

	})
	router.post('/api/shells/AIsourceManage/addfile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		await addAISourceFile(username, req.body.AISourceFile)
		res.status(200).json({ message: 'File added successfully' })
	})
	router.post('/api/shells/AIsourceManage/deletefile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		await deleteAISourceFile(username, req.body.AISourceFile)
		res.status(200).json({ message: 'File deleted successfully' })
	})
	router.post('/api/shells/AIsourceManage/getConfigTemplate', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const template = await getConfigTemplate(username, req.body.generator)
		res.status(200).json(template)
	})
}

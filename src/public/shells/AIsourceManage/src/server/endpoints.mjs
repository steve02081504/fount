import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { getAISourceFile, saveAISourceFile, addAISourceFile, deleteAISourceFile } from './manager.mjs'

export function setEndpoints(app) {
	// fount自带的/api/getlist/AIsources已经可以返回列表了，不用再次实现
	app.post('/api/shells/AIsourceManage/getfile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		try {
			const data = await getAISourceFile(username, req.body.AISourceFile)
			res.status(200).json(data)
		} catch (e) {
			res.status(404).json({ error: 'file not found' })
		}

	})
	app.post('/api/shells/AIsourceManage/setfile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		saveAISourceFile(username, req.body.AISourceFile, req.body.data)
		res.status(200).json({ message: 'File saved successfully' })

	})
	app.post('/api/shells/AIsourceManage/addfile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		addAISourceFile(username, req.body.AISourceFile)
		res.status(200).json({ message: 'File added successfully' })
	})
	app.post('/api/shells/AIsourceManage/deletefile', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		deleteAISourceFile(username, req.body.AISourceFile)
		res.status(200).json({ message: 'File deleted successfully' })
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/shells/AIsourceManage/getfile', (req, res) => {
		res.status(404)
	})
	app.post('/api/shells/AIsourceManage/setfile', (req, res) => {
		res.status(404)
	})
	app.post('/api/shells/AIsourceManage/addfile', (req, res) => {
		res.status(404)
	})
	app.post('/api/shells/AIsourceManage/deletefile', (req, res) => {
		res.status(404)
	})
}

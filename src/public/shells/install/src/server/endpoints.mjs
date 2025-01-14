import { authenticate, getUserByToken } from "../../../../../server/auth.mjs"
import { importPart, importPartByText } from "./Installer_handler.mjs"

export function setEndpoints(app) {
	// 文件上传接口
	app.post('/api/shells/install/file', authenticate, async (req, res) => {
		try {
			const user = await getUserByToken(req.cookies.accessToken)
			if (!user)
				return res.status(401).json({ message: '未授权' })

			if (!req.files || Object.keys(req.files).length === 0)
				return res.status(400).json({ message: '未上传文件' })

			for (const file of Object.values(req.files))
				await importPart(user.username, file.data)

			res.status(200).json({ message: '文件导入成功' })
		} catch (error) {
			console.error('文件导入失败:', error)
			res.status(500).json({ message: '文件导入失败', errors: error.errors, error: error.message })
		}
	})

	// 文本导入接口
	app.post('/api/shells/install/text', authenticate, async (req, res) => {
		try {
			const user = await getUserByToken(req.cookies.accessToken)
			if (!user)
				return res.status(401).json({ message: '未授权' })

			const { text } = req.body

			if (!text)
				return res.status(400).json({ message: '文本内容不能为空' })

			await importPartByText(user.username, text)

			res.status(200).json({ message: '文本导入成功' })
		} catch (error) {
			console.error('文本导入失败:', error)
			res.status(500).json({ message: '文本导入失败', errors: error.errors, error: error.message })
		}
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/shells/install/file', (req, res) => {
		res.status(404).send()
	})
	app.post('/api/shells/install/text', (req, res) => {
		res.status(404).send()
	})
}

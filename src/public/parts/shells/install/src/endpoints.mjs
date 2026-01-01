import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import { uninstallPartBase } from '../../../../../server/parts_loader.mjs'

import { importPart, importPartByText } from './Installer_handler.mjs'

/**
 * 为安装功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	// 文件上传接口
	router.post('/api/parts/shells:install/file', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user)
			return res.status(401).json({ message: '未授权' })

		if (!Object.keys(req.files || {}).length)
			return res.status(400).json({ message: '未上传文件' })

		for (const file of Object.values(req.files))
			await importPart(user.username, file.data)

		res.status(200).json({ message: '文件导入成功' })
	})

	// 文本导入接口
	router.post('/api/parts/shells:install/text', authenticate, async (req, res) => {
		const user = await getUserByReq(req)
		if (!user)
			return res.status(401).json({ message: '未授权' })

		const { text } = req.body

		if (!text)
			return res.status(400).json({ message: '文本内容不能为空' })

		await importPartByText(user.username, text)

		res.status(200).json({ message: '文本导入成功' })
	})

	// 删除请求发送
	router.post('/api/parts/shells:install/uninstall', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const partpath = (req.body.partpath || '').replace(/^\/+|\/+$/g, '')
		if (!partpath) return res.status(400).json({ message: 'partpath is required' })
		await uninstallPartBase(username, partpath)
		res.status(200).json({ message: '删除成功' })
	})
}

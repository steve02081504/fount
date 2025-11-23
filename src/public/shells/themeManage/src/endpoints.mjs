import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

import {
	deleteTheme,
	getCustomThemes,
	getTheme,
	saveTheme,
} from './storage.mjs'

/**
 * 设置主题管理Shell的API端点。
 * @param {object} router - Express路由器实例。
 */
export function setEndpoints(router) {
	// 获取列表
	router.get('/api/shells/themeManage/list', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(getCustomThemes(username))
	})

	// 获取单个主题
	router.get('/api/shells/themeManage/theme/:id', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const theme = getTheme(username, req.params.id)
		if (theme) res.json(theme)
		else res.status(404).json({ error: 'Not found' })
	})

	// 保存主题
	router.post('/api/shells/themeManage/save', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const id = saveTheme(username, req.body)
		res.json({ success: true, id })
	})

	// 删除主题
	router.delete('/api/shells/themeManage/theme/:id', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		deleteTheme(username, req.params.id)
		res.json({ success: true })
	})
}

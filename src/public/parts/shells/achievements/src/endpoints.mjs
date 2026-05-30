import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { getAllAchievements, lockAchievement, unlockAchievement } from './api.mjs'

/**
 * 为成就系统设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.get('/api/parts/shells\\:achievements/sources', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(await getAllAchievements(username))
	})

	router.post('/api/parts/shells\\:achievements/unlock', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partpath, id } = req.body
		res.status(200).json(await unlockAchievement(username, partpath, id))
	})

	router.post('/api/parts/shells\\:achievements/lock', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { partpath, id, reason } = req.body
		res.status(200).json(await lockAchievement(username, partpath, id, reason))
	})
}

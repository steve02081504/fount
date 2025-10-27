import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

import { getAllAchievements, lockAchievement, unlockAchievement } from './api.mjs'

export function setEndpoints(router) {
	router.get('/api/shells/achievements/sources', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.json(await getAllAchievements(username))
	})

	router.post('/api/shells/achievements/unlock/:parttype/:partname/:id', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname, id } = req.params
		const result = await unlockAchievement(username, parttype, partname, id)
		res.status(result.success ? 200 : 404).json(result)
	})

	router.post('/api/shells/achievements/lock/:parttype/:partname/:id', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { parttype, partname, id } = req.params
		const result = await lockAchievement(username, parttype, partname, id)
		res.status(result.success ? 200 : 404).json(result)
	})
}

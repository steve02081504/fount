import { authenticate, getUserByReq } from '../../../../../server/auth/index.mjs'

import { runPet, stopPet, getRunningPets } from './pet_runner.mjs'

/**
 * 为桌面宠物功能设置API端点。
 * @param {object} router - Express的路由实例。
 */
export function setEndpoints(router) {
	router.post('/api/parts/shells\\:deskpet/start', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { charname } = req.body
		await runPet(username, charname)
		res.status(200).json({ message: 'Pet started successfully', charname })
	})

	router.post('/api/parts/shells\\:deskpet/stop', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { charname } = req.body
		await stopPet(username, charname)
		res.status(200).json({ message: 'Pet stopped successfully', charname })
	})

	router.get('/api/parts/shells\\:deskpet/getrunningpetlist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json(getRunningPets(username))
	})
}

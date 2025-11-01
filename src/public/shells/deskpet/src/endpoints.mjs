import { console } from '../../../../scripts/i18n.mjs'
import { authenticate, getUserByReq } from '../../../../server/auth.mjs'

import { runPet, stopPet, getRunningPets } from './pet_runner.mjs'

/**
 * 设置API端点。
 * @param {object} router - 路由。
 */
export function setEndpoints(router) {
	router.post('/api/shells/deskpet/start', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { charname } = req.body
		try {
			await runPet(username, charname)
			res.status(200).json({ message: 'Pet started successfully', charname })
		} catch (error) {
			console.error(`[DeskPet] API error starting pet ${charname}:`, error)
			res.status(500).json({ message: error.message })
		}
	})

	router.post('/api/shells/deskpet/stop', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { charname } = req.body
		try {
			stopPet(username, charname) // Not async, but keep await for consistency if it changes
			res.status(200).json({ message: 'Pet stopped successfully', charname })
		} catch (error) {
			console.error(`[DeskPet] API error stopping pet ${charname}:`, error)
			res.status(500).json({ message: error.message })
		}
	})

	router.get('/api/shells/deskpet/getrunningpetlist', authenticate, async (req, res) => {
		try {
			const { username } = await getUserByReq(req)
			const running = getRunningPets(username)
			res.status(200).json(running)
		} catch (error) {
			console.error('[DeskPet] API error getting running pet list:', error)
			res.status(500).json({ message: error.message })
		}
	})
}

import { authenticate, getUserByToken } from "../../../../../server/auth.mjs"
import { getBotList, runBot } from "./bot.mjs"

export function setEndpoints(app) {
	app.post('/api/shells/discordbot/start', authenticate, async (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		const { botname } = req.body
		await runBot(username, botname)
		res.status(200).json({ message: 'start ok', botname })
	})

	app.post('/api/shells/discordbot/getbotlist', authenticate, (req, res) => {
		const { username } = getUserByToken(req.cookies.token)
		res.status(200).json(getBotList(username))
	})
}

export function unsetEndpoints(app) {
	app.post('/api/shells/discordbot/start', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/discordbot/getbotlist', (req, res) => {
		res.status(404)
	})
}

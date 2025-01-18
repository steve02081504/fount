import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { getBotList, runBot, getBotConfig, setBotConfig, deleteBotConfig } from './bot.mjs'

export function setEndpoints(app) {
	app.post('/api/shells/discordbot/start', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		try {
			await runBot(username, botname)
			res.status(200).json({ message: 'start ok', botname })
		} catch (error) {
			res.status(500).json({ message: error.message })
		}
	})

	app.get('/api/shells/discordbot/getbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		res.status(200).json(getBotList(username))
	})

	app.post('/api/shells/discordbot/getbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		res.status(200).json(getBotConfig(username, botname))
	})

	app.post('/api/shells/discordbot/setbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname, config } = req.body
		setBotConfig(username, botname, config)
		res.status(200).json({ message: 'config saved' })
	})

	app.post('/api/shells/discordbot/deletebotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		deleteBotConfig(username, botname)
		res.status(200).json({ message: 'bot deleted' })
	})

	app.post('/api/shells/discordbot/newbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		setBotConfig(username, botname, {})
		res.status(200).json({ message: 'bot created' })
	})
}

export function unsetEndpoints(app) {
	if (!app) return
	app.post('/api/shells/discordbot/start', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/discordbot/getbotlist', (req, res) => {
		res.status(404)
	})

	app.get('/api/shells/discordbot/getcharlist', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/discordbot/getbotconfig', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/discordbot/setbotconfig', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/discordbot/deletebotconfig', (req, res) => {
		res.status(404)
	})

	app.post('/api/shells/discordbot/newbotconfig', (req, res) => {
		res.status(404)
	})
}

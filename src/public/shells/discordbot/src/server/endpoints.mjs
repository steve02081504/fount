import { authenticate, getUserByToken } from '../../../../../server/auth.mjs'
import { getBotList, runBot, getBotConfig, setBotConfig, deleteBotConfig, getRunningBotList, stopBot, getBotConfigTemplate } from './bot.mjs'

export function setEndpoints(router) {
	router.post('/api/shells/discordbot/start', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		await runBot(username, botname)
		res.status(200).json({ message: 'start ok', botname })
	})

	router.post('/api/shells/discordbot/stop', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		await stopBot(username, botname)
		res.status(200).json({ message: 'stop ok', botname })
	})

	router.get('/api/shells/discordbot/getbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		res.status(200).json(getBotList(username))
	})

	router.get('/api/shells/discordbot/getrunningbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		res.status(200).json(getRunningBotList(username))
	})

	router.get('/api/shells/discordbot/getbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.query
		const config = await getBotConfig(username, botname)
		res.status(200).json(config)
	})

	router.get('/api/shells/discordbot/getbotConfigTemplate', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { charname } = req.query
		const config = await getBotConfigTemplate(username, charname)
		res.status(200).json(config)
	})

	router.post('/api/shells/discordbot/setbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname, config } = req.body
		setBotConfig(username, botname, config)
		res.status(200).json({ message: 'config saved' })
	})

	router.post('/api/shells/discordbot/deletebotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		deleteBotConfig(username, botname)
		res.status(200).json({ message: 'bot deleted' })
	})

	router.post('/api/shells/discordbot/newbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByToken(req.cookies.accessToken)
		const { botname } = req.body
		setBotConfig(username, botname, {})
		res.status(200).json({ message: 'bot created' })
	})
}

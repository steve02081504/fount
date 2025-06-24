import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'
import {
	getBotList,
	runBot,
	getBotConfig,
	setBotConfig,
	deleteBotConfig,
	getRunningBotList,
	stopBot,
	getBotConfigTemplate
} from './bot.mjs' // 确保从 telegrambot 的 bot.mjs 导入

export function setEndpoints(router) {
	// 启动 Telegram Bot
	router.post('/api/shells/telegrambot/start', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		if (!botname) return res.status(400).json({ message: 'Bot name is required.' })
		await runBot(username, botname)
		res.status(200).json({ message: `Telegram bot ${botname} started successfully.`, botname })
	})

	// 停止 Telegram Bot
	router.post('/api/shells/telegrambot/stop', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		if (!botname) return res.status(400).json({ message: 'Bot name is required.' })
		await stopBot(username, botname)
		res.status(200).json({ message: `Telegram bot ${botname} stopped successfully.`, botname })
	})

	// 获取用户的所有 Telegram Bot 列表
	router.get('/api/shells/telegrambot/getbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const list = getBotList(username)
		res.status(200).json(list)
	})

	// 获取正在运行的 Telegram Bot 列表
	router.get('/api/shells/telegrambot/getrunningbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const list = getRunningBotList(username)
		res.status(200).json(list)
	})

	// 获取特定 Telegram Bot 的配置
	router.get('/api/shells/telegrambot/getbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.query
		if (!botname) return res.status(400).json({ message: 'Bot name query parameter is required.' })
		const config = await getBotConfig(username, botname)
		res.status(200).json(config)
	})

	// 获取特定角色用于 Telegram Bot 的配置模板
	router.get('/api/shells/telegrambot/getbotConfigTemplate', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { charname } = req.query
		if (!charname) return res.status(400).json({ message: 'Character name query parameter is required.' })
		const template = await getBotConfigTemplate(username, charname)
		res.status(200).json(template)
	})

	// 设置/保存特定 Telegram Bot 的配置
	router.post('/api/shells/telegrambot/setbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname, config } = req.body
		if (!botname || !config) return res.status(400).json({ message: 'Bot name and config are required.' })
		setBotConfig(username, botname, config)
		res.status(200).json({ message: 'Telegram bot config saved successfully.' })
	})

	// 删除特定 Telegram Bot 的配置
	router.post('/api/shells/telegrambot/deletebotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		if (!botname) return res.status(400).json({ message: 'Bot name is required.' })

		// 确保机器人已停止
		const runningBots = getRunningBotList(username)
		if (runningBots.includes(botname))
			await stopBot(username, botname)


		deleteBotConfig(username, botname)
		res.status(200).json({ message: `Telegram bot ${botname} deleted successfully.` })
	})

	// 创建一个新的 Telegram Bot 配置 (空配置)
	router.post('/api/shells/telegrambot/newbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		if (!botname) return res.status(400).json({ message: 'Bot name is required.' })
		// 检查是否已存在同名bot
		const existingBots = getBotList(username)
		if (existingBots.includes(botname))
			return res.status(409).json({ message: `Bot with name ${botname} already exists.` })

		setBotConfig(username, botname, { token: '', char: '', config: {} }) // 初始为空配置
		res.status(200).json({ message: `New Telegram bot ${botname} created successfully.` })
	})
}

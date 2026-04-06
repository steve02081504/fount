import { authenticate, getUserByReq } from '../../../../../server/auth.mjs'

import { getBotList, runBot, getBotConfig, setBotConfig, deleteBotConfig, getRunningBotList, stopBot, getBotConfigTemplate } from './bot.mjs'
import { DEFAULT_WECHAT_ILINK_BASE } from './wechat_api.mjs'
import { pollQrSession, startQrSession } from './wechat_qr.mjs'

/**
 * 将 QR 登录结果（token + apiBaseUrl + ilinkUserId）写回机器人保存的配置。
 * 仅在 OwnerWeChatId 仍持有配置模板中的占位值时覆盖它。
 * @param {string} username 用户名。
 * @param {{ botname: string, token: string, apiBaseUrl: string, ilinkUserId?: string }} pollResult QR 登录轮询结果。
 */
function applyQrLoginResult(username, pollResult) {
	const existingConfig = getBotConfig(username, pollResult.botname)
	const botSpecificConfig = { ...existingConfig.config || {} }
	const normalizedUrl = String(pollResult.apiBaseUrl || DEFAULT_WECHAT_ILINK_BASE).replace(/\/+$/, '')

	if (pollResult.ilinkUserId && (!botSpecificConfig.OwnerWeChatId || String(botSpecificConfig.OwnerWeChatId).includes('your_')))
		botSpecificConfig.OwnerWeChatId = pollResult.ilinkUserId

	setBotConfig(username, pollResult.botname, {
		...existingConfig,
		token: pollResult.token,
		apiBaseUrl: normalizedUrl,
		config: botSpecificConfig,
	})
}

/**
 * wechatbot 的 API 端点。
 * @param {object} router - Express 路由实例。
 */
export function setEndpoints(router) {
	router.post('/api/parts/shells\\:wechatbot/start', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		await runBot(username, botname)
		res.status(200).json({ message: 'start ok', botname })
	})

	router.post('/api/parts/shells\\:wechatbot/stop', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		await stopBot(username, botname)
		res.status(200).json({ message: 'stop ok', botname })
	})

	router.get('/api/parts/shells\\:wechatbot/getbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json(getBotList(username))
	})

	router.get('/api/parts/shells\\:wechatbot/getrunningbotlist', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		res.status(200).json(getRunningBotList(username))
	})

	router.get('/api/parts/shells\\:wechatbot/getbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.query
		const config = await getBotConfig(username, botname)
		res.status(200).json(config)
	})

	router.get('/api/parts/shells\\:wechatbot/getbotConfigTemplate', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { charname } = req.query
		const config = await getBotConfigTemplate(username, charname)
		res.status(200).json(config)
	})

	router.post('/api/parts/shells\\:wechatbot/setbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname, config } = req.body
		setBotConfig(username, botname, config)
		res.status(200).json({ message: 'config saved' })
	})

	router.post('/api/parts/shells\\:wechatbot/deletebotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		deleteBotConfig(username, botname)
		res.status(200).json({ message: 'bot deleted' })
	})

	router.post('/api/parts/shells\\:wechatbot/newbotconfig', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body
		setBotConfig(username, botname, {})
		res.status(200).json({ message: 'bot created' })
	})

	router.post('/api/parts/shells\\:wechatbot/qrcode/start', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { botname } = req.body || {}
		try {
			const out = await startQrSession({ username, botname: botname || null })
			res.status(200).json(out)
		}
		catch (e) {
			res.status(500).json({ message: e?.message || String(e) })
		}
	})

	router.get('/api/parts/shells\\:wechatbot/qrcode/poll', authenticate, async (req, res) => {
		const { username } = await getUserByReq(req)
		const { sessionKey } = req.query
		if (!sessionKey || typeof sessionKey !== 'string')
			return res.status(400).json({ message: 'sessionKey required' })

		const pollResult = await pollQrSession(sessionKey, username)

		if (pollResult.connected && pollResult.token && pollResult.botname)
			applyQrLoginResult(username, pollResult)

		res.status(200).json(pollResult)
	})
}

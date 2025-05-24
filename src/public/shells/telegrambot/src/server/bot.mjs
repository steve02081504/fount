import { Telegraf } from 'npm:telegraf@^4.16.3' // 引入 Telegraf
import { on_shutdown } from '../../../../../server/on_shutdown.mjs' // 用于注册进程关闭时的回调
import { loadShellData, loadTempData, saveShellData } from '../../../../../server/setting_loader.mjs' // Fount 的数据加载/保存工具
import { LoadChar } from '../../../../../server/managers/char_manager.mjs' // 加载角色
import { getAllUserNames } from '../../../../../server/auth.mjs' // 获取所有用户名
import { StartJob, EndJob } from '../../../../../server/jobs.mjs' // Fount 的任务管理
import { geti18n } from '../../../../../scripts/i18n.mjs' // 国际化
import { createSimpleTelegramInterface } from './default_interface/main.mjs' // 默认的 Telegram 角色接口
import { events } from '../../../../../server/events.mjs'

/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */

/**
 * 启动 Telegram Bot。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @param {{
 *  token: string,
 *  char: string,
 *  config: any
 * }} botConfig - 从 bot_configs.json 加载的机器人配置。
 * @param {charAPI_t} char - 加载后的角色 API 对象。
 * @returns {Promise<import('npm:telegraf').Telegraf>} Telegraf 实例。
 */
async function startTelegrafBot(botConfig, char) {
	// 创建 Telegraf 实例
	const bot = new Telegraf(botConfig.token)

	// 允许角色自定义其 Telegram 接口的设置
	// char.interfaces.telegram 是角色 manifest.json 中定义的 telegram 接口
	// botConfig.config 是用户在前端UI的JSON编辑器中为此特定机器人实例配置的内容
	await char.interfaces.telegram?.BotSetup?.(bot, botConfig.config)
	const me = await bot.telegram.getMe()

	// 启动机器人
	// 使用 try-catch 包装 bot.launch() 以便捕获启动时可能发生的错误 (例如无效token)
	bot.launch() // Telegraf v4 的启动方式
	console.info(await geti18n('fountConsole.telegrambot.botStarted', {
		botusername: me.username,
		charname: botConfig.char
	}))
	return bot
}

/**
 * 获取指定用户的所有 Telegram Bot 配置数据。
 * @param {string} username - 用户名。
 * @returns {Object<string, any>} 包含所有机器人配置的哈希表。
 */
function getBotsData(username) {
	// 'telegrambot' 是 shell 的名称，'bot_configs' 是数据文件名 (不含 .json 后缀)
	return loadShellData(username, 'telegrambot', 'bot_configs') || {}
}

/**
 * 获取指定用户的特定 Telegram Bot 的配置。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @returns {Object | undefined} 机器人的配置对象，如果不存在则为 undefined。
 */
export function getBotConfig(username, botname) {
	const botsData = getBotsData(username)
	return botsData[botname]
}

/**
 * 获取指定角色用于 Telegram Bot 的默认配置模板。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<Object>} 配置模板对象。
 */
export async function getBotConfigTemplate(username, charname) {
	const char = await LoadChar(username, charname)
	// 如果角色没有定义 telegram 接口，则使用默认接口
	char.interfaces.telegram ??= await createSimpleTelegramInterface(char, username, charname)
	// 调用角色接口的 GetBotConfigTemplate 方法，如果不存在则返回空对象
	return await char.interfaces.telegram?.GetBotConfigTemplate?.() || {}
}

/**
 * 保存/更新指定用户的特定 Telegram Bot 的配置。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @param {Object} config - 要保存的配置对象。
 */
export function setBotConfig(username, botname, config) {
	const botsData = getBotsData(username)
	botsData[botname] = config
	// saveShellData 会自动处理创建目录和文件 (如果不存在)
	saveShellData(username, 'telegrambot', 'bot_configs', botsData)
}

/**
 * 删除指定用户的特定 Telegram Bot 的配置。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 */
export function deleteBotConfig(username, botname) {
	const botsData = getBotsData(username)
	delete botsData[botname]
	saveShellData(username, 'telegrambot', 'bot_configs', botsData)
}

/**
 * 运行一个 Telegram Bot。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @throws {Error} 如果机器人配置不存在或 Token 无效等。
 */
export async function runBot(username, botname) {
	// 'telegrambot_cache' 用于存储正在运行的机器人实例或其启动 Promise
	const botCache = loadTempData(username, 'telegrambot_cache')
	if (botCache[botname]) { // 如果机器人已在运行或正在启动，则不执行任何操作
		console.warn(await geti18n('fountConsole.telegrambot.alreadyRunning', { botname }))
		return
	}

	const config = getBotConfig(username, botname)

	// 将启动过程包装在 Promise 中并存入缓存，以防止重复启动
	botCache[botname] = (async () => {
		const char = await LoadChar(username, config.char)
		// 如果角色没有定义 telegram 接口，则使用默认接口
		char.interfaces.telegram ??= await createSimpleTelegramInterface(char, username, config.char)
		return await startTelegrafBot(config, char)
	})()

	try {
		// 等待机器人启动完成，并将 Telegraf 实例存回缓存
		botCache[botname] = await botCache[botname]
		// 在 Fount 任务系统中注册此机器人为一个正在运行的任务
		StartJob(username, 'shells', 'telegrambot', botname)
	} catch (error) {
		// 如果启动失败，从缓存中移除，并向上抛出错误
		delete botCache[botname]
		// 不需要在这里 console.error，因为 startTelegrafBot 已经记录了
		throw error // 向上层抛出，以便API端点可以捕获并返回给前端
	}
}

/**
 * 停止一个 Telegram Bot。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 */
export async function stopBot(username, botname) {
	const botCache = loadTempData(username, 'telegrambot_cache')
	botCache[botname] = await botCache[botname]

	try {
		await botCache[botname].stop('SIGINT')
	}
	finally {
		// 无论停止是否成功，都从缓存中移除
		delete botCache[botname]
	}
	// 在 Fount 任务系统中标记此机器人任务已结束
	EndJob(username, 'shells', 'telegrambot', botname)
}

/**
 * 获取指定用户正在运行的 Telegram Bot 列表。
 * @param {string} username - 用户名。
 * @returns {string[]} 正在运行的机器人名称列表。
 */
export function getRunningBotList(username) {
	return Object.keys(loadTempData(username, 'telegrambot_cache'))
}

// 注册一个在 Fount 进程关闭时执行的回调
on_shutdown(async () => {
	const users = getAllUserNames() // 获取所有 Fount 用户
	for (const username of users) {
		const botCache = loadTempData(username, 'telegrambot_cache')
		for (const botname of Object.keys(botCache)) try {
			botCache[botname] = await botCache[botname]
			await botCache[botname].stop('SIGINT')
		}
		finally {
			delete botCache[botname]
		}
	}
})

/**
 * 获取指定用户的所有已配置的 Telegram Bot 名称列表。
 * @param {string} username - 用户名。
 * @returns {string[]} Bot 名称列表。
 */
export function getBotList(username) {
	return Object.keys(getBotsData(username))
}

// Event Handlers
events.on('BeforeUserDeleted', async ({ username, userId }) => {
	const runningBots = getRunningBotList(username)
	for (const botname of runningBots)
		try {
			await stopBot(username, botname)
			console.log(`Telegram Bot: Stopped bot ${botname} for deleted user ${username}`)
		} catch (error) {
			console.error(`Telegram Bot: Error stopping bot ${botname} for deleted user ${username}:`, error)
		}
})

events.on('BeforeUserRenamed', async ({ oldUsername, newUsername, userId, newUserData }) => {
	const runningBotsOldUser = getRunningBotList(oldUsername)
	for (const botname of runningBotsOldUser)
		try {
			await stopBot(oldUsername, botname)
			console.log(`Telegram Bot: Stopped bot ${botname} for old username ${oldUsername}`)
		} catch (error) {
			console.error(`Telegram Bot: Error stopping bot ${botname} for old username ${oldUsername}:`, error)
		}
})

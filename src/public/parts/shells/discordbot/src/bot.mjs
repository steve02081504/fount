import { Client, Events, GatewayIntentBits, Partials } from 'npm:discord.js@^14.25.0'
import { on_shutdown } from 'npm:on-shutdown'

import { console } from '../../../../../scripts/i18n.mjs'
import { getAllUserNames } from '../../../../../server/auth.mjs'
import { events } from '../../../../../server/events.mjs'
import { EndJob, StartJob } from '../../../../../server/jobs.mjs'
import { loadPart } from '../../../../../server/parts_loader.mjs'
import { loadShellData, loadTempData, saveShellData } from '../../../../../server/setting_loader.mjs'
import { unlockAchievement } from '../../achievements/src/api.mjs'
/** @typedef {import('../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */

/**
 * 启动 Discord Bot
 * @param {{
 * 	token: string,
 * 	config: any
 * }} config - 机器人配置
 * @param {CharAPI_t} char - 角色 API
 * @returns {Promise<import('npm:discord.js').Client>} - Discord 客户端实例
 */
async function startBot(config, char) {
	const client = new Client({
		intents: char.interfaces.discord?.Intents || [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.GuildPresences,
			GatewayIntentBits.GuildMessageReactions,
			GatewayIntentBits.GuildMessageTyping,
			GatewayIntentBits.GuildMembers,
			GatewayIntentBits.MessageContent,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.DirectMessageReactions,
			GatewayIntentBits.DirectMessageTyping,
		],
		partials: char.interfaces.discord?.Partials || [
			Partials.Channel,
			Partials.Message,
			Partials.User,
			Partials.GuildMember,
			Partials.Reaction
		],
	})

	client.once(Events.ClientReady, async client => {
		await char.interfaces.discord?.OnceClientReady(client, config.config)
		console.infoI18n('fountConsole.discordbot.botStarted', {
			botusername: client.user.username,
			charname: config.char
		})
	})

	await client.login(config.token)

	return client
}

/**
 * 获取机器人数据。
 * @param {string} username - 用户名。
 * @returns {object} - 机器人数据。
 */
function getBotsData(username) {
	return loadShellData(username, 'discordbot', 'bot_configs')
}

/**
 * 获取机器人配置。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @returns {object} - 机器人配置。
 */
export function getBotConfig(username, botname) {
	const botsData = getBotsData(username)
	return botsData[botname] || {}
}

/**
 * 获取机器人配置模板。
 * @param {string} username - 用户名。
 * @param {string} charname - 角色名称。
 * @returns {Promise<object>} - 机器人配置模板。
 */
export async function getBotConfigTemplate(username, charname) {
	const char = await loadPart(username, 'chars/' + charname)
	if (!char.interfaces.discord) {
		const { createSimpleDiscordInterface } = await import('./default_interface/main.mjs')
		char.interfaces.discord = await createSimpleDiscordInterface(char, username, charname)
	}
	return await char.interfaces.discord?.GetBotConfigTemplate?.() || {}
}

/**
 * 设置机器人配置。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @param {object} config - 配置。
 * @returns {void}
 */
export function setBotConfig(username, botname, config) {
	const botsData = getBotsData(username)
	botsData[botname] = config
	saveShellData(username, 'discordbot', 'bot_configs')
}

/**
 * 删除机器人配置。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @returns {void}
 */
export function deleteBotConfig(username, botname) {
	const botsData = getBotsData(username)
	delete botsData[botname]
	saveShellData(username, 'discordbot', 'bot_configs')
}

/**
 * 运行机器人。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<void>}
 */
export async function runBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')
	if (botCache[botname]) return
	botCache[botname] = (async _ => {
		const config = getBotConfig(username, botname)
		if (!Object.keys(config).length) throw new Error(`Bot ${botname} not found`)
		const char = await loadPart(username, 'chars/' + config.char)
		if (!char.interfaces.discord) {
			const { createSimpleDiscordInterface } = await import('./default_interface/main.mjs')
			char.interfaces.discord = await createSimpleDiscordInterface(char, username, config.char)
		}
		const client = await startBot(config, char)
		return client
	})()

	try {
		botCache[botname] = await botCache[botname]
		StartJob(username, 'shells/discordbot', botname)
		unlockAchievement(username, 'shells/discordbot', 'start_bot')
	}
	catch (error) {
		delete botCache[botname]
		throw error
	}
}

/**
 * 停止机器人。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<void>}
 */
export async function stopBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')

	if (botCache[botname]) try {
		const client = await botCache[botname]
		await client.destroy()
	} finally {
		delete botCache[botname]
	}

	EndJob(username, 'shells/discordbot', botname)
}

/**
 * 暂停机器人（停止运行但不从 config 中移除，以便 PauseAllJobs 后可通过 ReStartJobs 恢复）。
 * @param {string} username - 用户名。
 * @param {string} botname - 机器人名称。
 * @returns {Promise<void>}
 */
export async function pauseBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')
	if (!botCache[botname]) return

	try {
		const client = await botCache[botname]
		await client.destroy()
	} finally {
		delete botCache[botname]
	}
}
on_shutdown(async () => {
	for (const username of getAllUserNames())
		for (const botname of [...Object.keys(loadTempData(username, 'discordbot_cache'))])
			await pauseBot(username, botname).catch(console.error)
})

/**
 * 获取正在运行的机器人列表。
 * @param {string} username - 用户名。
 * @returns {Array<string>} - 正在运行的机器人列表。
 */
export function getRunningBotList(username) {
	return Object.keys(loadTempData(username, 'discordbot_cache'))
}


/**
 * 获取机器人列表。
 * @param {string} username - 用户名。
 * @returns {Array<string>} - 机器人列表。
 */
export function getBotList(username) {
	return Object.keys(getBotsData(username))
}

// Event Handlers
events.on('BeforeUserDeleted', async ({ username }) => {
	const runningBots = getRunningBotList(username)
	for (const botname of runningBots) try {
		await stopBot(username, botname)
		console.log(`Discord Bot: Stopped bot ${botname} for deleted user ${username}`)
	} catch (error) {
		console.error(`Discord Bot: Error stopping bot ${botname} for deleted user ${username}:`, error)
	}
})

events.on('BeforeUserRenamed', async ({ oldUsername, newUsername }) => {
	const runningBotsOldUser = getRunningBotList(oldUsername)
	for (const botname of runningBotsOldUser) try {
		await stopBot(oldUsername, botname)
		console.log(`Discord Bot: Stopped bot ${botname} for old username ${oldUsername}`)
	} catch (error) {
		console.error(`Discord Bot: Error stopping bot ${botname} for old username ${oldUsername}:`, error)
	}
})

import { Client, Events, GatewayIntentBits, Partials } from 'npm:discord.js@^14.18.0'
import { on_shutdown } from '../../../../../server/on_shutdown.mjs'
import { loadShellData, loadTempData, saveShellData } from '../../../../../server/setting_loader.mjs'
import { LoadChar } from '../../../../../server/managers/char_manager.mjs'
import { getAllUserNames } from '../../../../../server/auth.mjs'
import { StartJob, EndJob } from '../../../../../server/jobs.mjs'
import { geti18n } from '../../../../../scripts/i18n.mjs'
/** @typedef {import('../../../../../decl/charAPI.ts').charAPI_t} charAPI_t */

/**
 * 启动 Discord Bot
 * @param {{
 * 	token: string,
 * 	config: any
 * }} config
 * @param {charAPI_t} char
 * @returns {Promise<import('npm:discord.js').Client>}
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
		console.info(await geti18n('fountConsole.discordbot.botStarted', {
			botusername: client.user.username,
			charname: config.char
		}))
	})

	await client.login(config.token)

	return client
}

function getBotsData(username) {
	return loadShellData(username, 'discordbot', 'bot_configs')
}

export function getBotConfig(username, botname) {
	const botsData = getBotsData(username)
	return botsData[botname] || {}
}

export async function getBotConfigTemplate(username, charname) {
	const char = await LoadChar(username, charname)
	return await char.interfaces.discord?.GetBotConfigTemplate?.() || {}
}

export function setBotConfig(username, botname, config) {
	const botsData = getBotsData(username)
	botsData[botname] = config
	saveShellData(username, 'discordbot', 'bot_configs')
}

export function deleteBotConfig(username, botname) {
	const botsData = getBotsData(username)
	delete botsData[botname]
	saveShellData(username, 'discordbot', 'bot_configs')
}

export async function runBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')
	if (botCache[botname]) return
	botCache[botname] = (async _ => {
		const config = getBotConfig(username, botname)
		if (!Object.keys(config).length) throw new Error(`Bot ${botname} not found`)
		const char = await LoadChar(username, config.char)
		if (!char.interfaces.discord) throw new Error(`Char ${config.char} does not support discord interface`)
		const client = await startBot(config, char)
		return client
	})()

	try {
		botCache[botname] = await botCache[botname]
		StartJob(username, 'shells', 'discordbot', botname)
	} catch (error) {
		delete botCache[botname]
		throw error
	}
}

export async function stopBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')

	if (botCache[botname]) try {
		const client = await botCache[botname]
		await client.destroy()
	} finally {
		delete botCache[botname]
	}

	EndJob(username, 'shells', 'discordbot', botname)
}

export function getRunningBotList(username) {
	return Object.keys(loadTempData(username, 'discordbot_cache'))
}

on_shutdown(async () => {
	for (const username in getAllUserNames())
		for (const botname in getRunningBotList(username))
			await stopBot(username, botname)
})

export function getBotList(username) {
	return Object.keys(getBotsData(username))
}

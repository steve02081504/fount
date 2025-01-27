import { Client, Events, GatewayIntentBits, Partials } from 'npm:discord.js'
import { on_shutdown } from '../../../../../server/on_shutdown.mjs'
import { loadData, loadTempData, saveData } from '../../../../../server/setting_loader.mjs'
import { LoadChar } from '../../../../../server/managers/char_manager.mjs'
import { getAllUserNames } from '../../../../../server/auth.mjs'
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

	client.once(Events.ClientReady, client => char.interfaces.discord?.OnceClientReady(client, config.config))

	await client.login(config.token)

	return client
}

function getBotsData(username) {
	return loadData(username, 'discordbot_configs')
}

export function getBotConfig(username, botname) {
	const botsData = getBotsData(username)
	return botsData[botname] || {}
}

export function setBotConfig(username, botname, config) {
	const botsData = getBotsData(username)
	botsData[botname] = config
	saveData(username, 'discordbot_configs', botsData)
}

export function deleteBotConfig(username, botname) {
	const botsData = getBotsData(username)
	delete botsData[botname]
	saveData(username, 'discordbot_configs', botsData)
}

export async function runBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')
	if (botCache[botname]) return
	const config = getBotConfig(username, botname)
	if (!Object.keys(config).length) throw new Error(`Bot ${botname} not found`)
	const char = await LoadChar(username, config.char)
	if (!char.interfaces.discord) throw new Error(`Char ${config.char} does not support discord interface`)
	botCache[botname] = await startBot(config, char)
}

export async function stopBot(username, botname) {
	const botCache = loadTempData(username, 'discordbot_cache')
	if (botCache[botname]) {
		botCache[botname].destroy()
		delete botCache[botname]
	}
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

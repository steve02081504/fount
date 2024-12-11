import { Client, Events, GatewayIntentBits, Partials } from 'npm:discord.js'
import { on_shutdown } from '../../../../../server/on_shutdown.mjs'
import { loadData } from '../../../../../server/setting_loader.mjs'
import { LoadChar } from '../../../../../server/managers/char_manager.mjs'
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
		intents: char.interfacies.discord.Intents || [
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
		partials: char.interfacies.discord.Partials || [
			Partials.Channel,
			Partials.Message,
			Partials.User,
			Partials.GuildMember,
			Partials.Reaction
		],
	})

	client.once(Events.ClientReady, client => char.interfacies.discord.OnceClientReady(client, config.config))

	await client.login(config.token)
	on_shutdown(() => client.destroy())

	return client
}

function getBotsData(username) {
	return loadData(username, 'discordbot_configs')
}

function getBotCongfig(username, botname) {
	return getBotsData(username)[botname] ??= {}
}

export async function runBot(username, botname) {
	let config = getBotCongfig(username, botname)
	if (!Object.keys(config).length) throw new Error(`Bot ${botname} not found`)
	let char = await LoadChar(username, config.char)
	await startBot(config, char)
}

export function getBotList(username) {
	return Object.keys(getBotsData(username))
}

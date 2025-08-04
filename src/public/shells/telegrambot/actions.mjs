import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './src/server/bot.mjs'

export const actions = {
	list: ({ user }) => getBotList(user),
	create: ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for create action.')
		setBotConfig(user, botname, {})
		return `Bot '${botname}' created.`
	},
	delete: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for delete action.')
		await deleteBotConfig(user, botname)
		return `Bot '${botname}' deleted.`
	},
	config: async ({ user, botname, configData }) => {
		if (!botname) throw new Error('Bot name is required for config action.')
		await setBotConfig(user, botname, configData)
		return `Bot '${botname}' configured.`
	},
	'get-config': ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for get-config action.')
		return getPartData(user, botname)
	},
	'get-template': ({ user, charname }) => {
		if (!charname) throw new Error('Char name is required for get-template action.')
		return getBotConfigTemplate(user, charname)
	},
	start: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for start action.')
		await runBot(user, botname)
		return `Bot '${botname}' started.`
	},
	stop: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for stop action.')
		await stopBot(user, botname)
		return `Bot '${botname}' stopped.`
	}
}

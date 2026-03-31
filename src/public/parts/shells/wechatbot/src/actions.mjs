import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './bot.mjs'

/**
 * @param {string|undefined} botname 机器人名称。
 * @param {string} action 动作名称（用于错误消息）。
 */
function assertBotname(botname, action) {
	if (!botname) throw new Error(`Bot name is required for ${action} action.`)
}

/**
 *
 */
export const actions = {
	/** @param {{ user: string }} root0 */
	list: ({ user }) => getBotList(user),

	/** @param {{ user: string, botname: string }} root0 */
	create: ({ user, botname }) => {
		assertBotname(botname, 'create')
		setBotConfig(user, botname, {})
		return `Bot '${botname}' created.`
	},

	/** @param {{ user: string, botname: string }} root0 */
	delete: ({ user, botname }) => {
		assertBotname(botname, 'delete')
		deleteBotConfig(user, botname)
		return `Bot '${botname}' deleted.`
	},

	/** @param {{ user: string, botname: string, configData: any }} root0 */
	config: ({ user, botname, configData }) => {
		assertBotname(botname, 'config')
		setBotConfig(user, botname, configData)
		return `Bot '${botname}' configured.`
	},

	/** @param {{ user: string, botname: string }} root0 */
	'get-config': ({ user, botname }) => {
		assertBotname(botname, 'get-config')
		return getPartData(user, botname)
	},

	/** @param {{ user: string, charname: string }} root0 */
	'get-template': ({ user, charname }) => {
		if (!charname) throw new Error('Char name is required for get-template action.')
		return getBotConfigTemplate(user, charname)
	},

	/** @param {{ user: string, botname: string }} root0 */
	start: async ({ user, botname }) => {
		assertBotname(botname, 'start')
		await runBot(user, botname)
		return `Bot '${botname}' started.`
	},

	/** @param {{ user: string, botname: string }} root0 */
	stop: async ({ user, botname }) => {
		assertBotname(botname, 'stop')
		await stopBot(user, botname)
		return `Bot '${botname}' stopped.`
	}
}

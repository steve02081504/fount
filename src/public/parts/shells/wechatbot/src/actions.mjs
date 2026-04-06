import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './bot.mjs'

/**
 * 断言机器人名称。
 * @param {string|undefined} botname 机器人名称。
 * @param {string} action 动作名称（用于错误消息）。
 */
function assertBotname(botname, action) {
	if (!botname) throw new Error(`Bot name is required for ${action} action.`)
}

/**
 * wechatbot shell 的动作。
 */
export const actions = {
	/**
	 * 列出机器人。
	 * @param {{ user: string }} root0 参数对象。
	 * @returns {Promise<string[]>} 机器人列表。
	 */
	list: ({ user }) => getBotList(user),

	/**
	 * 创建机器人。
	 * @param {{ user: string, botname: string }} root0 参数对象。
	 * @returns {string} 创建结果消息。
	 */
	create: ({ user, botname }) => {
		assertBotname(botname, 'create')
		setBotConfig(user, botname, {})
		return `Bot '${botname}' created.`
	},

	/**
	 * 删除机器人。
	 * @param {{ user: string, botname: string }} root0 参数对象。
	 * @returns {string} 删除结果消息。
	 */
	delete: ({ user, botname }) => {
		assertBotname(botname, 'delete')
		deleteBotConfig(user, botname)
		return `Bot '${botname}' deleted.`
	},

	/**
	 * 配置机器人。
	 * @param {{ user: string, botname: string, configData: any }} root0 参数对象。
	 * @returns {string} 配置结果消息。
	 */
	config: ({ user, botname, configData }) => {
		assertBotname(botname, 'config')
		setBotConfig(user, botname, configData)
		return `Bot '${botname}' configured.`
	},

	/**
	 * 获取机器人配置。
	 * @param {{ user: string, botname: string }} root0 参数对象。
	 * @returns {object} 机器人配置。
	 */
	'get-config': ({ user, botname }) => {
		assertBotname(botname, 'get-config')
		return getPartData(user, botname)
	},

	/**
	 * 获取机器人配置模板。
	 * @param {{ user: string, charname: string }} root0 参数对象。
	 * @returns {object} 机器人配置模板。
	 */
	'get-template': ({ user, charname }) => {
		if (!charname) throw new Error('Char name is required for get-template action.')
		return getBotConfigTemplate(user, charname)
	},

	/**
	 * 启动机器人。
	 * @param {{ user: string, botname: string }} root0 参数对象。
	 * @returns {string} 启动结果消息。
	 */
	start: async ({ user, botname }) => {
		assertBotname(botname, 'start')
		await runBot(user, botname)
		return `Bot '${botname}' started.`
	},

	/**
	 * 停止机器人。
	 * @param {{ user: string, botname: string }} root0 参数对象。
	 * @returns {string} 停止结果消息。
	 */
	stop: async ({ user, botname }) => {
		assertBotname(botname, 'stop')
		await stopBot(user, botname)
		return `Bot '${botname}' stopped.`
	}
}

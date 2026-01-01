import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './bot.mjs'

/**
 * 定义了可用于Discord机器人的各种操作。
 */
export const actions = {
	/**
	 * 列出所有可用的Discord机器人。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @returns {Promise<Array<string>>} - 可用机器人的列表。
	 */
	list: ({ user }) => getBotList(user),
	/**
	 * 创建一个新的Discord机器人。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.botname - 要创建的机器人的名称。
	 * @returns {string} - 确认消息。
	 */
	create: ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for create action.')
		setBotConfig(user, botname, {})
		return `Bot '${botname}' created.`
	},
	/**
	 * 删除一个现有的Discord机器人。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.botname - 要删除的机器人的名称。
	 * @returns {Promise<string>} - 确认消息。
	 */
	delete: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for delete action.')
		await deleteBotConfig(user, botname)
		return `Bot '${botname}' deleted.`
	},
	/**
	 * 配置一个Discord机器人。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.botname - 要配置的机器人的名称。
	 * @param {object} root0.configData - 配置数据。
	 * @returns {Promise<string>} - 确认消息。
	 */
	config: async ({ user, botname, configData }) => {
		if (!botname) throw new Error('Bot name is required for config action.')
		await setBotConfig(user, botname, configData)
		return `Bot '${botname}' configured.`
	},
	/**
	 * 获取一个Discord机器人的配置。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.botname - 要获取配置的机器人的名称。
	 * @returns {Promise<object>} - 配置数据。
	 */
	'get-config': ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for get-config action.')
		return getPartData(user, botname)
	},
	/**
	 * 获取一个Discord机器人的配置模板。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.charname - 用于生成模板的角色名称。
	 * @returns {Promise<object>} - 配置模板。
	 */
	'get-template': ({ user, charname }) => {
		if (!charname) throw new Error('Char name is required for get-template action.')
		return getBotConfigTemplate(user, charname)
	},
	/**
	 * 启动一个Discord机器人。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.botname - 要启动的机器人的名称。
	 * @returns {Promise<string>} - 确认消息。
	 */
	start: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for start action.')
		await runBot(user, botname)
		return `Bot '${botname}' started.`
	},
	/**
	 * 停止一个Discord机器人。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.botname - 要停止的机器人的名称。
	 * @returns {Promise<string>} - 确认消息。
	 */
	stop: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for stop action.')
		await stopBot(user, botname)
		return `Bot '${botname}' stopped.`
	}
}

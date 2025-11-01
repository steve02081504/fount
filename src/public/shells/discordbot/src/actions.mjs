import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './bot.mjs'

/**
 * Discord Bot 操作
 */
export const actions = {
	/**
	 * 列出所有机器人。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {Promise<Array<string>>} - 机器人列表。
	 */
	list: ({ user }) => getBotList(user),
	/**
	 * 创建机器人。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.botname - 机器人名称。
	 * @returns {string} - 成功消息。
	 */
	create: ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for create action.')
		setBotConfig(user, botname, {})
		return `Bot '${botname}' created.`
	},
	/**
	 * 删除机器人。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.botname - 机器人名称。
	 * @returns {Promise<string>} - 成功消息。
	 */
	delete: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for delete action.')
		await deleteBotConfig(user, botname)
		return `Bot '${botname}' deleted.`
	},
	/**
	 * 配置机器人。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.botname - 机器人名称。
	 * @param {object} root0.configData - 配置数据。
	 * @returns {Promise<string>} - 成功消息。
	 */
	config: async ({ user, botname, configData }) => {
		if (!botname) throw new Error('Bot name is required for config action.')
		await setBotConfig(user, botname, configData)
		return `Bot '${botname}' configured.`
	},
	/**
	 * 获取机器人配置。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.botname - 机器人名称。
	 * @returns {Promise<object>} - 配置数据。
	 */
	'get-config': ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for get-config action.')
		return getPartData(user, botname)
	},
	/**
	 * 获取机器人配置模板。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.charname - 角色名称。
	 * @returns {Promise<object>} - 配置模板。
	 */
	'get-template': ({ user, charname }) => {
		if (!charname) throw new Error('Char name is required for get-template action.')
		return getBotConfigTemplate(user, charname)
	},
	/**
	 * 启动机器人。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.botname - 机器人名称。
	 * @returns {Promise<string>} - 成功消息。
	 */
	start: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for start action.')
		await runBot(user, botname)
		return `Bot '${botname}' started.`
	},
	/**
	 * 停止机器人。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.botname - 机器人名称。
	 * @returns {Promise<string>} - 成功消息。
	 */
	stop: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for stop action.')
		await stopBot(user, botname)
		return `Bot '${botname}' stopped.`
	}
}

import { runBot, stopBot, getBotList, setBotConfig, deleteBotConfig, getBotConfig as getPartData, getBotConfigTemplate } from './bot.mjs'

/**
 * @file telegrambot/src/actions.mjs
 * @description telegrambot 的动作。
 * @namespace telegrambot.actions
 */

/**
 * @name actions
 * @memberof telegrambot.actions
 * @description 可用的动作。
 * @property {function} list - 列出机器人。
 * @property {function} create - 创建机器人。
 * @property {function} delete - 删除机器人。
 * @property {function} config - 配置机器人。
 * @property {function} get-config - 获取机器人配置。
 * @property {function} get-template - 获取机器人配置模板。
 * @property {function} start - 启动机器人。
 * @property {function} stop - 停止机器人。
 */
export const actions = {
	/**
	 * @function list
	 * @memberof telegrambot.actions
	 * @description 列出机器人。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @returns {Promise<string[]>} - 机器人列表。
	 */
	list: ({ user }) => getBotList(user),
	/**
	 * @function create
	 * @memberof telegrambot.actions
	 * @description 创建机器人。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.botname - 机器人名称。
	 * @returns {string} - 结果消息。
	 */
	create: ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for create action.')
		setBotConfig(user, botname, {})
		return `Bot '${botname}' created.`
	},
	/**
	 * @function delete
	 * @memberof telegrambot.actions
	 * @description 删除机器人。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.botname - 机器人名称。
	 * @returns {Promise<string>} - 结果消息。
	 */
	delete: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for delete action.')
		await deleteBotConfig(user, botname)
		return `Bot '${botname}' deleted.`
	},
	/**
	 * @function config
	 * @memberof telegrambot.actions
	 * @description 配置机器人。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.botname - 机器人名称。
	 * @param {object} params.configData - 配置数据。
	 * @returns {Promise<string>} - 结果消息。
	 */
	config: async ({ user, botname, configData }) => {
		if (!botname) throw new Error('Bot name is required for config action.')
		await setBotConfig(user, botname, configData)
		return `Bot '${botname}' configured.`
	},
	/**
	 * @function get-config
	 * @memberof telegrambot.actions
	 * @description 获取机器人配置。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.botname - 机器人名称。
	 * @returns {Promise<object>} - 配置数据。
	 */
	'get-config': ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for get-config action.')
		return getPartData(user, botname)
	},
	/**
	 * @function get-template
	 * @memberof telegrambot.actions
	 * @description 获取机器人配置模板。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.charname - 角色名称。
	 * @returns {Promise<object>} - 配置模板。
	 */
	'get-template': ({ user, charname }) => {
		if (!charname) throw new Error('Char name is required for get-template action.')
		return getBotConfigTemplate(user, charname)
	},
	/**
	 * @function start
	 * @memberof telegrambot.actions
	 * @description 启动机器人。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.botname - 机器人名称。
	 * @returns {Promise<string>} - 结果消息。
	 */
	start: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for start action.')
		await runBot(user, botname)
		return `Bot '${botname}' started.`
	},
	/**
	 * @function stop
	 * @memberof telegrambot.actions
	 * @description 停止机器人。
	 * @param {object} params - 参数。
	 * @param {string} params.user - 用户。
	 * @param {string} params.botname - 机器人名称。
	 * @returns {Promise<string>} - 结果消息。
	 */
	stop: async ({ user, botname }) => {
		if (!botname) throw new Error('Bot name is required for stop action.')
		await stopBot(user, botname)
		return `Bot '${botname}' stopped.`
	}
}

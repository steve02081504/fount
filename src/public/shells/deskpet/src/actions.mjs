import { runPet, stopPet, getPetList, getRunningPetList } from './pet_runner.mjs'

/**
 * 定义了可用于桌面宠物功能的各种操作。
 */
export const actions = {
	/**
	 * 列出所有可用的桌面宠物。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @returns {Promise<Array<string>>} - 可用桌面宠物的列表。
	 */
	list: ({ user }) => getPetList(user),
	/**
	 * 列出当前正在运行的桌面宠物。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @returns {Promise<Array<string>>} - 正在运行的桌面宠物列表。
	 */
	'list-running': ({ user }) => getRunningPetList(user),
	/**
	 * 启动一个桌面宠物。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.charname - 要启动的宠物的角色名称。
	 * @returns {Promise<string>} - 确认消息。
	 */
	start: async ({ user, charname }) => {
		if (!charname) throw new Error('Character name is required for start action.')
		await runPet(user, charname)
		return `Pet '${charname}' started.`
	},
	/**
	 * 停止一个桌面宠物。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.charname - 要停止的宠物的角色名称。
	 * @returns {Promise<string>} - 确认消息。
	 */
	stop: async ({ user, charname }) => {
		if (!charname) throw new Error('Character name is required for stop action.')
		await stopPet(user, charname)
		return `Pet '${charname}' stopped.`
	}
}

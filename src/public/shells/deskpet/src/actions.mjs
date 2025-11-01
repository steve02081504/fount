import { runPet, stopPet, getPetList, getRunningPetList } from './pet_runner.mjs'

/**
 * 桌面宠物操作
 */
export const actions = {
	/**
	 * 列出所有宠物。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {Promise<Array<string>>} - 宠物列表。
	 */
	list: ({ user }) => getPetList(user),
	/**
	 * 列出正在运行的宠物。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {Promise<Array<string>>} - 正在运行的宠物列表。
	 */
	'list-running': ({ user }) => getRunningPetList(user),
	/**
	 * 启动宠物。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.charname - 角色名称。
	 * @returns {Promise<string>} - 成功消息。
	 */
	start: async ({ user, charname }) => {
		if (!charname) throw new Error('Character name is required for start action.')
		await runPet(user, charname)
		return `Pet '${charname}' started.`
	},
	/**
	 * 停止宠物。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.charname - 角色名称。
	 * @returns {Promise<string>} - 成功消息。
	 */
	stop: async ({ user, charname }) => {
		if (!charname) throw new Error('Character name is required for stop action.')
		await stopPet(user, charname)
		return `Pet '${charname}' stopped.`
	}
}

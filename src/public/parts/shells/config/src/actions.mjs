import { getPartData, setPartData } from './manager.mjs'

/**
 * 定义了可用于组件配置的各种操作。
 */
export const actions = {
	/**
	 * 获取指定组件的数据。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partpath - 组件的路径。
	 * @returns {Promise<any>} - 组件的数据。
	 */
	get: async ({ user, partpath }) => {
		if (!partpath) throw new Error('partpath is required.')
		return getPartData(user, partpath)
	},
	/**
	 * 设置指定组件的数据。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partpath - 组件的路径。
	 * @param {any} root0.data - 要设置的数据。
	 * @returns {Promise<string>} - 确认消息。
	 */
	set: async ({ user, partpath, data }) => {
		if (!partpath) throw new Error('partpath is required.')
		await setPartData(user, partpath, data)
		return `Config for ${partpath} updated.`
	}
}

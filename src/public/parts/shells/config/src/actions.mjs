import { getPartData, setPartData } from './manager.mjs'

/**
 * 定义了可用于组件配置的各种操作。
 */
export const actions = {
	/**
	 * 获取指定组件的数据。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partType - 组件的类型。
	 * @param {string} root0.partName - 组件的名称。
	 * @returns {Promise<any>} - 组件的数据。
	 */
	get: async ({ user, partType, partName }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		return getPartData(user, partType, partName)
	},
	/**
	 * 设置指定组件的数据。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partType - 组件的类型。
	 * @param {string} root0.partName - 组件的名称。
	 * @param {any} root0.data - 要设置的数据。
	 * @returns {Promise<string>} - 确认消息。
	 */
	set: async ({ user, partType, partName, data }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		await setPartData(user, partType, partName, data)
		return `Config for ${partType} '${partName}' updated.`
	}
}

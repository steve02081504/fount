import { getPartData, setPartData } from './manager.mjs'

/**
 * @description 配置操作
 */
export const actions = {
	/**
	 * @description 获取部件数据。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.partType - 部件类型。
	 * @param {string} root0.partName - 部件名称。
	 * @returns {Promise<any>} - 部件数据。
	 */
	get: async ({ user, partType, partName }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		return getPartData(user, partType, partName)
	},
	/**
	 * @description 设置部件数据。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.partType - 部件类型。
	 * @param {string} root0.partName - 部件名称。
	 * @param {any} root0.data - 数据。
	 * @returns {Promise<string>} - 成功消息。
	 */
	set: async ({ user, partType, partName, data }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		await setPartData(user, partType, partName, data)
		return `Config for ${partType} '${partName}' updated.`
	}
}

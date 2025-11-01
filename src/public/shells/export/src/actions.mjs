import { exportPart } from './manager.mjs'

/**
 * @description 导出操作
 */
export const actions = {
	/**
	 * @description 默认导出操作。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.partType - 部件类型。
	 * @param {string} root0.partName - 部件名称。
	 * @param {boolean} root0.withData - 是否包含数据。
	 * @returns {Promise<any>} - 导出结果。
	 */
	default: async ({ user, partType, partName, withData }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		return exportPart(user, partType, partName, withData)
	}
}

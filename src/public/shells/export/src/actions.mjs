import { exportPart } from './manager.mjs'

/**
 * 定义了可用于导出的各种操作。
 */
export const actions = {
	/**
	 * 执行默认的导出操作。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partType - 要导出的组件类型。
	 * @param {string} root0.partName - 要导出的组件名称。
	 * @param {boolean} root0.withData - 是否包含数据一起导出。
	 * @returns {Promise<any>} - 导出的结果。
	 */
	default: async ({ user, partType, partName, withData }) => {
		if (!partType || !partName) throw new Error('Part type and name are required.')
		return exportPart(user, partType, partName, withData)
	}
}

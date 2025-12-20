import { exportPart } from './manager.mjs'

/**
 * 定义了可用于导出的各种操作。
 */
export const actions = {
	/**
	 * 执行默认的导出操作。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partpath - 要导出的部件路径。
	 * @param {boolean} root0.withData - 是否包含数据一起导出。
	 * @returns {Promise<any>} - 导出的结果。
	 */
	default: async ({ user, partpath, withData }) => {
		if (!partpath) throw new Error('partpath is required.')
		return exportPart(user, partpath, withData)
	}
}

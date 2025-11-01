import { loadPart } from '../../../../server/managers/index.mjs'

/**
 * 预加载操作
 */
export const actions = {
	/**
	 * 默认操作。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @param {string} root0.parttype - 部件类型。
	 * @param {string} root0.partname - 部件名称。
	 */
	default: ({ user, parttype, partname }) => {
		loadPart(user, parttype, partname)
	}
}

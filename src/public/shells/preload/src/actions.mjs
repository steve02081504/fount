import { loadPart } from '../../../../server/managers/index.mjs'

/**
 * 定义了可用于预加载的各种操作。
 */
export const actions = {
	/**
	 * 执行默认的预加载操作。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.parttype - 要预加载的组件类型。
	 * @param {string} root0.partname - 要预加载的组件名称。
	 */
	default: ({ user, parttype, partname }) => {
		loadPart(user, parttype, partname)
	}
}

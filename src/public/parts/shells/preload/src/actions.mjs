import { loadPart } from '../../../../../server/parts_loader.mjs'

/**
 * 定义了可用于预加载的各种操作。
 */
export const actions = {
	/**
	 * 执行默认的预加载操作。
	 * @param {object} root0 - 参数对象。
	 * @param {string} root0.user - 用户的名称。
	 * @param {string} root0.partpath - 要预加载的组件路径（例如 'chars/GentianAphrodite'）。
	 */
	default: ({ user, partpath }) => {
		const normalizedPartpath = partpath.replace(/^\/+|\/+$/g, '')
		loadPart(user, normalizedPartpath)
	}
}

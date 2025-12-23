import { get_hosturl_in_local_ip } from '../../../../../scripts/ratelimit.mjs'

/**
 * 定义了用于在其他设备上访问的操作。
 */
export const actions = {
	/**
	 * 获取在本地网络中可访问的主机URL。
	 * @returns {string} - 返回构造的URL，用于在本地网络中的其他设备上访问。
	 */
	default: () => get_hosturl_in_local_ip()
}

import { get_hosturl_in_local_ip } from '../../../../scripts/ratelimit.mjs'

/**
 * 在其他设备访问操作
 */
export const actions = {
	/**
	 * 获取本地IP的主机URL。
	 * @returns {string} - 主机URL。
	 */
	default: () => get_hosturl_in_local_ip()
}

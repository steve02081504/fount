import { get_hosturl_in_local_ip } from '../../../../scripts/ratelimit.mjs'

/**
 * @description 在其他设备访问操作
 */
export const actions = {
	/**
	 * @description 获取本地IP的主机URL。
	 * @returns {string} - 主机URL。
	 */
	default: () => get_hosturl_in_local_ip()
}

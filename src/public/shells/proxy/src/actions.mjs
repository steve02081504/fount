import { hosturl } from '../../../../server/server.mjs'

/**
 * @description 代理操作
 */
export const actions = {
	/**
	 * @description 获取OpenAI兼容的API端点。
	 * @param {object} root0 - 参数。
	 * @param {string} root0.user - 用户。
	 * @returns {string} - API端点URL。
	 */
	default: ({ user }) => `${hosturl}/api/shells/proxy/calling/openai`
}
